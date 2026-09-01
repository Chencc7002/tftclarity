import { STRUCTURED_OPERATION_REGISTRY } from "../../retrieval/structured-retriever.js";
import { AGENT_TOOL_SCHEMA_VERSION } from "./registry.js";
import { ToolError } from "./tool-errors.js";

const DESCRIPTIONS = Object.freeze({
  unit_builds: "Use for current structured unit build statistics. Not for arbitrary URLs or model-generated facts. Input contains validated unit query constraints. Returns existing unit-build response data.",
  unit_builds_batch: "Return current structured build statistics for at most five validated units. Send only keys declared by inputSchema. seasonContextId, patch, and scopeKey are server-scoped and MUST NOT appear in arguments. Optional starLevel accepts one or more explicit levels from 1 to 3; omit it when the user did not specify a level so the server reuses the fixed-query cost-based default (1-3 cost units use 3 stars, 4-5 cost units use 2 stars). Optional constraints.lockedItems and constraints.excludedItems are deterministic query-affecting filters applied to source rows before ranking; the response echoes all effective query conditions and provenance. For composition item-contention analysis, compositionId, entities, and optionsPerUnit must exactly match the deterministic itemContentionQueryPlan from prior resolved comps_rankings evidence. The response computes itemContentionPlan internally from cross-unit build-option intersections and never assigns item priority.",
  unit_comp_candidates: "Use for validated unit composition candidates. Not for global rankings. Input contains a unit and bounded sample scope. Returns existing candidate data.",
  item_carrier_rankings: "Use for current item-to-carrier statistics. Input requires one validated item and returns deterministic positive-uplift carrier aggregates with representative builds. Not for model-generated item advice.",
  comps_rankings: "Resolve a user-facing composition mention against current live MetaTFT composition definitions, or return current composition rankings when mention is omitted. Use the returned resolution status; never invent a composition identity or silently choose an ambiguous candidate. Member-of-composition and itemized-candidate relations are evidence, but do not imply primary carry, primary tank, core member, or flex slot unless separately supported.",
  composition_tactical_details: "Return verified MetaTFT positioning and compatible gold/prismatic augment references for one previously resolved composition. formation.units[].boardPosition is the authoritative user-facing row/column translation and combatProfile.attackRange is official unit evidence; raw cell is only a provider identifier. compositionId, clusterId, units, and seasonContextId must exactly match the tacticalDetailQueryPlan from prior resolved comps_rankings evidence. Never invent board cells, units, or augments.",
  composition_replacement_evaluation: "Deterministically evaluate a user-specified member replacement in one resolved current composition. Requires a compositionId from prior resolved comps_rankings evidence and official unit_details evidence for both targetApiName and replacementApiName. Returns validated membership plus exact trait-count and breakpoint deltas. It never claims the replacement is stronger or finds the best replacement.",
  composition_change_evaluation: "Deterministically evaluate one user-specified composition member change: add, remove, or replace. Requires a compositionId from prior resolved comps_rankings evidence. add requires incomingApiName and its official unit_details evidence; remove requires targetApiName and its official unit_details evidence; replace requires both. Returns exact before/after members, trait counts, and breakpoint deltas. Never calculate these changes yourself or claim the changed composition is stronger.",
  comps_trends: "Use for composition trend retrieval, including requests asking which comps became weaker, declined, fell, improved, rose, or became stronger. Use direction=falling for weaker/declining requests and direction=rising for stronger/improving requests. Do not substitute current absolute rankings for a change-over-time question. Not for causal claims. Returns existing trend evidence.",
  comps_analysis: "Use for deterministic composition analysis evidence. Not for LLM-created statistics. Input contains validated analysis scope. Returns existing analysis inputs.",
  unit_details: "Requires an official unit apiName and returns current trusted unit catalog details. For a user-facing name or alias, call entity_catalog_query first. Do not guess apiName. Not for live ranking statistics.",
  item_details: "Requires an official item apiName and returns current trusted item catalog details. For a user-facing name or alias, call entity_catalog_query first. Do not guess apiName. Not for ranking equipment strength.",
  item_details_batch: "Return current-season official details for 1 to 4 item apiNames selected by a deterministic prior unit_builds or unit_builds_batch plan. The apiNames must exactly match the supplied mechanismQueryPlan or composition itemContentionPlan; never add, remove, or reorder items.",
  trait_details: "Requires an official trait apiName and returns current trusted trait catalog details. For a user-facing name or alias, call entity_catalog_query first. Do not guess apiName. Not for live composition strength.",
  entity_catalog_query: "Query current TFT units, items or traits with bounded filters or exact normalized name/alias resolution. For natural-language entity names, call this before a details tool and follow resolution.requests[].status; never guess an apiName or silently choose an ambiguous candidate.",
  composition_member_statistics: "Aggregate current composition samples by unit and optionally exclude native members of a target trait. Use for non-trait splash-unit statistics, never emblem-carrier rankings.",
  semantic_search: "Search only the local knowledge index for mechanism_knowledge, patch_note, static_game_knowledge, or explicitly requested video_guide documents. Never use for current statistics, realtime web/video discovery, or strength ranking. Creator advice must stay attributed.",
  strategy_video_search: "Search Bilibili for current TFT strategy-video candidates through the configured MCP adapter. Returns source links, publish-time patch inference, detail availability, interaction signals, fallback metadata, and traceable ranking signals. It does not inspect or validate video content and must never be described as an攻略正确性评分。"
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
      goals: ["recommend_builds_for_candidate_group", "recommend_best_option"],
      outputs: ["recommendation", "recommendations", "results", "ranking", "evidence"]
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
  composition_tactical_details: Object.freeze([
    Object.freeze({
      action: "explain",
      requiredEntityTypes: ["composition"],
      allowedEntityTypes: ["composition", "champion", "game_concept", "patch"],
      features: ["composition_positioning", "composition_augment_references"],
      outputs: ["explanation", "evidence"]
    })
  ]),
  composition_replacement_evaluation: Object.freeze([
    Object.freeze({
      action: "analyze",
      requiredEntityTypes: ["composition", "champion"],
      allowedEntityTypes: ["composition", "champion", "trait", "patch"],
      goals: ["analyze_evidence"],
      features: ["composition_replacement_structural_evaluation"],
      outputs: ["analysis", "evidence"]
    }),
    Object.freeze({
      action: "compare",
      requiredEntityTypes: ["composition", "champion"],
      allowedEntityTypes: ["composition", "champion", "trait", "patch"],
      goals: ["choose_best"],
      features: ["composition_replacement_structural_evaluation"],
      outputs: ["comparison", "evidence"]
    })
  ]),
  composition_change_evaluation: Object.freeze([
    Object.freeze({
      action: "analyze",
      requiredEntityTypes: ["composition", "champion"],
      allowedEntityTypes: ["composition", "champion", "trait", "patch"],
      goals: ["analyze_evidence"],
      features: ["composition_member_change_structural_evaluation"],
      outputs: ["analysis", "evidence"]
    }),
    Object.freeze({
      action: "compare",
      requiredEntityTypes: ["composition", "champion"],
      allowedEntityTypes: ["composition", "champion", "trait", "patch"],
      goals: ["choose_best"],
      features: ["composition_member_change_structural_evaluation"],
      outputs: ["comparison", "evidence"]
    })
  ]),
  item_details_batch: Object.freeze([
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
  ]),
  strategy_video_search: Object.freeze([
    Object.freeze({
      action: "find_video",
      allowedEntityTypes: ["champion", "composition", "trait", "game_concept", "patch", "video"],
      allowNoEntities: true,
      features: ["strategy_video_search"],
      goals: ["find_strategy_video"],
      outputs: ["video_candidates", "evidence"]
    })
  ])
});

const EVIDENCE_TYPES = Object.freeze({
  unit_builds: "unit_build_statistics",
  unit_builds_batch: "unit_build_batch_statistics",
  unit_comp_candidates: "composition_candidates",
  item_carrier_rankings: "item_carrier_statistics",
  comps_rankings: "composition_rankings",
  composition_tactical_details: "composition_tactical_details",
  composition_replacement_evaluation: "composition_replacement_evaluation",
  composition_change_evaluation: "composition_change_evaluation",
  comps_trends: "composition_trends",
  comps_analysis: "composition_analysis",
  unit_details: "official_unit",
  item_details: "official_item",
  item_details_batch: "official_item_batch",
  trait_details: "official_trait",
  entity_catalog_query: "official_entity_catalog",
  composition_member_statistics: "trait_external_unit_statistics",
  semantic_search: "semantic_candidates",
  strategy_video_search: "strategy_video_candidates"
});

const PARAMETER_SCHEMAS = Object.freeze({
  unit: { type: "string" },
  item: { type: "string" },
  mention: { type: "string" },
  compositionId: { type: "string", minLength: 1, maxLength: 160 },
  clusterId: { type: "string", pattern: "^[0-9]{1,12}$" },
  units: {
    type: "array",
    minItems: 1,
    maxItems: 12,
    uniqueItems: true,
    items: { type: "string", pattern: "^(?:TFT|DA_)[A-Za-z0-9_]+$" }
  },
  targetApiName: { type: "string", minLength: 1, maxLength: 160 },
  replacementApiName: { type: "string", minLength: 1, maxLength: 160 },
  incomingApiName: { type: "string", minLength: 1, maxLength: 160 },
  operation: { type: "string", enum: ["add", "remove", "replace"] },
  optionsPerUnit: { type: "integer", minimum: 1, maximum: 3 },
  apiName: { type: "string" },
  apiNames: {
    type: "array",
    minItems: 1,
    maxItems: 4,
    items: { type: "string", minLength: 1, maxLength: 160 }
  },
  seasonContextId: { type: "string", minLength: 1, maxLength: 80 },
  days: { type: "integer" },
  patch: { type: "string" },
  queue: { type: ["string", "number"] },
  rank: { type: "array", items: { type: "string" } },
  starLevel: {
    type: "array",
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    items: { type: "integer", minimum: 1, maximum: 3 }
  },
  itemCount: { type: "integer" },
  traitFilters: { type: "array", items: { type: "string" } },
  comp: { type: ["object", "null"] },
  itemPolicy: { type: "string" },
  itemCategories: { type: "array", items: { type: "string" } },
  lockedItems: { type: "array", items: { type: "string" } },
  excludedItems: { type: "array", items: { type: "string" } },
  comparisonItems: { type: "array", items: { type: "string" } },
  performanceItem: { type: "string", minLength: 1, maxLength: 160 },
  primaryMetric: {
    type: "string",
    enum: ["top4Rate", "winRate", "avgPlacement", "games"]
  },
  constraints: {
    type: "object",
    additionalProperties: false,
    properties: {
      lockedItems: {
        type: "array",
        maxItems: 3,
        items: { type: "string", minLength: 1, maxLength: 160 }
      },
      excludedItems: {
        type: "array",
        maxItems: 6,
        items: { type: "string", minLength: 1, maxLength: 160 }
      }
    }
  },
  minSamples: { type: "integer" },
  strategy: { type: "string" },
  metrics: { type: "array", items: { type: "string" } },
  limit: { type: "integer" },
  direction: { type: "string", enum: ["rising", "falling"] },
  page: { type: "integer", minimum: 1, maximum: 100 },
  query: { type: "string" },
  ecosystem: { type: "string", enum: ["tft_pc", "golden_spatula", "both"] },
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
    not: { required: ["names", "apiNames"] },
    properties: {
      cost: { oneOf: [{ type: "integer" }, { type: "array", items: { type: "integer" } }] },
      traits: { type: "array", items: { type: "string" } },
      names: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: { type: "string", minLength: 1, maxLength: 80 }
      },
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
  composition_tactical_details: Object.freeze([
    "compositionId", "clusterId", "units", "seasonContextId"
  ]),
  composition_replacement_evaluation: Object.freeze([
    "compositionId", "targetApiName", "replacementApiName", "seasonContextId"
  ]),
  composition_change_evaluation: Object.freeze([
    "operation", "compositionId", "seasonContextId"
  ]),
  unit_details: Object.freeze(["apiName"]),
  item_details: Object.freeze(["apiName"]),
  item_details_batch: Object.freeze(["apiNames", "seasonContextId"]),
  trait_details: Object.freeze(["apiName"]),
  entity_catalog_query: Object.freeze(["entityType"]),
  composition_member_statistics: Object.freeze(["trait"]),
  semantic_search: Object.freeze(["query"]),
  strategy_video_search: Object.freeze(["query"])
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
    trustTier: registration.trustTier ?? "first_party",
    plannerAllowed: registration.plannerAllowed === true,
    sideEffect: "none",
    requiresApproval: false,
    permissions: [`${registration.source}:read`],
    credentialScope: registration.credentialScope ?? "none",
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
