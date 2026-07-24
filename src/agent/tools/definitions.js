import { STRUCTURED_OPERATION_REGISTRY } from "../../retrieval/structured-retriever.js";
import { AGENT_TOOL_SCHEMA_VERSION } from "./registry.js";
import { ToolError } from "./tool-errors.js";

const DESCRIPTIONS = Object.freeze({
  unit_builds: "Use for current structured unit build statistics. Not for arbitrary URLs or model-generated facts. Input contains validated unit query constraints. Returns existing unit-build response data.",
  unit_comp_candidates: "Use for validated unit composition candidates. Not for global rankings. Input contains a unit and bounded sample scope. Returns existing candidate data.",
  comps_rankings: "Use for current composition rankings. Not for historical claims without evidence. Input contains validated ranking scope. Returns existing page-aligned ranking data.",
  comps_trends: "Use for composition trend retrieval. Not for causal claims. Input contains validated trend scope. Returns existing trend evidence.",
  comps_analysis: "Use for deterministic composition analysis evidence. Not for LLM-created statistics. Input contains validated analysis scope. Returns existing analysis inputs.",
  unit_details: "Use for current trusted unit catalog details. Not for live ranking statistics. Input requires an official unit apiName. Returns catalog data.",
  item_details: "Use for current trusted item catalog details. Not for ranking equipment strength. Input requires an official item apiName. Returns catalog data.",
  trait_details: "Use for current trusted trait catalog details. Not for live composition strength. Input requires an official trait apiName. Returns catalog data.",
  semantic_search: "Use for static semantic recall of aliases and descriptions. Not for realtime statistics or strength ranking. Input contains a bounded query and filters. Returns semantic candidates."
});

const PARAMETER_SCHEMAS = Object.freeze({
  unit: { type: "string" },
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
  metrics: { type: "array", items: { type: "string" } },
  limit: { type: "integer" },
  query: { type: "string" },
  documentTypes: { type: "array", items: { type: "string" } },
  locale: { type: "string" },
  topK: { type: "integer" }
});

const REQUIRED_PARAMETERS = Object.freeze({
  unit_builds: Object.freeze(["unit"]),
  unit_comp_candidates: Object.freeze(["unit", "mention"]),
  unit_details: Object.freeze(["apiName"]),
  item_details: Object.freeze(["apiName"]),
  trait_details: Object.freeze(["apiName"]),
  semantic_search: Object.freeze(["query"])
});

export function createStructuredToolDefinitions(options = {}) {
  return Object.entries(STRUCTURED_OPERATION_REGISTRY).map(([name, registration]) => ({
    schemaVersion: AGENT_TOOL_SCHEMA_VERSION,
    name,
    version: "1",
    description: DESCRIPTIONS[name] ?? `Use only for allowlisted ${name} retrieval. Not for arbitrary operations. Returns existing deterministic data.`,
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
