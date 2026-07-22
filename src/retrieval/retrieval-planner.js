import {
  RETRIEVAL_PLAN_SCHEMA_VERSION,
  createRetrievalPlan,
  validateIntentEnvelope
} from "./contracts.js";
import { CONCLUSION_SPEC_REGISTRY } from "../llm/conclusion-spec-registry.js";

const DEFAULT_EVIDENCE_BUDGET = Object.freeze({ maxItems: 40, maxCharacters: 16000 });
function specForEnvelope(envelope) {
  if (!CONCLUSION_SPEC_REGISTRY.supportsIntent(envelope.intent)) return null;
  return CONCLUSION_SPEC_REGISTRY.resolve({
    intent: envelope.intent,
    questionType: envelope.questionType,
    resultType: envelope.intent
  });
}

function flattenedEvidence(spec) {
  return [...new Set(Object.values(spec?.requiredEvidence ?? {}).flat())];
}

// Compatibility exports are projections of the registry, never independent configuration.
const PROMPT_KEYS = Object.freeze(Object.fromEntries(CONCLUSION_SPEC_REGISTRY.list({ enabled: true })
  .filter((entry) => entry.match.questionType === "default")
  .map((entry) => [entry.match.intent, entry.prompt.key])));
const REQUIRED_EVIDENCE = Object.freeze(Object.fromEntries(CONCLUSION_SPEC_REGISTRY.list({ enabled: true })
  .filter((entry) => entry.match.questionType === "default")
  .map((entry) => [entry.match.intent, flattenedEvidence(entry)])));

const DETAIL_OPERATIONS = Object.freeze({
  unit_details: "unit_details",
  item_details: "item_details",
  trait_details: "trait_details"
});

function entity(envelope, type) {
  return envelope.entities.find((entry) => entry.type === type) ?? null;
}

function compactParams(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function unitBuildQuery(envelope) {
  const constraints = envelope.constraints;
  const unit = entity(envelope, "unit")?.apiName;
  return {
    id: "structured:unit_builds",
    source: "metatft",
    operation: "unit_builds",
    params: compactParams({
      unit,
      days: constraints.days,
      patch: constraints.patch,
      queue: constraints.queue,
      rank: constraints.rankFilter,
      starLevel: constraints.starLevel,
      itemCount: constraints.itemCount,
      traitFilters: constraints.traitFilters,
      comp: constraints.comp,
      itemPolicy: constraints.itemPolicy,
      itemCategories: constraints.itemCategories,
      lockedItems: constraints.lockedItems,
      excludedItems: constraints.excludedItems,
      comparisonItems: constraints.comparisonItems,
      minSamples: constraints.minSamples
    }),
    required: true
  };
}

function unitCompCandidatesQuery(envelope) {
  const constraints = envelope.constraints;
  return {
    id: "structured:unit_comp_candidates",
    source: "metatft",
    operation: "unit_comp_candidates",
    params: compactParams({
      unit: entity(envelope, "unit")?.apiName,
      mention: constraints.compMention,
      days: constraints.days,
      patch: constraints.patch,
      queue: constraints.queue,
      rank: constraints.rankFilter,
      minSamples: constraints.minSamples
    }),
    required: false
  };
}

function compQuery(envelope) {
  const constraints = envelope.constraints;
  return {
    id: envelope.intent === "comp_trends"
      ? "structured:comp_trends"
      : envelope.intent === "comp_analysis"
        ? "structured:comp_analysis"
        : "structured:comp_rankings",
    source: "metatft",
    operation: envelope.intent === "comp_trends"
      ? "comps_trends"
      : envelope.intent === "comp_analysis"
        ? "comps_analysis"
        : "comps_rankings",
    params: compactParams({
      days: constraints.days,
      patch: constraints.patch,
      queue: constraints.queue,
      rank: constraints.rankFilter,
      minSamples: constraints.minSamples,
      metrics: constraints.metrics,
      limit: constraints.limit
    }),
    required: true
  };
}

function shouldRetrieveSemantics(envelope, options) {
  if (options.forceSemantic === true) return true;
  if (options.includeStaticKnowledge === true) return true;
  if (envelope.entities.some((entry) => !["exact_catalog", "exact_alias", "substring"].includes(entry.resolution))) return true;
  return false;
}

function semanticQuery(envelope, options) {
  const documentTypes = ["comp_trends", "comp_rankings", "comp_analysis"].includes(envelope.intent)
    ? ["comp", "comp_description"]
    : envelope.intent === "unit_emblem_rankings"
      ? ["unit", "trait", "emblem_description"]
      : ["unit", "item", "trait", "unit_description", "item_description", "trait_description"];
  return {
    id: "semantic:entity_and_static_knowledge",
    index: "entity_and_static_knowledge",
    query: envelope.input,
    types: documentTypes,
    patch: envelope.constraints.patch ?? options.patch ?? null,
    locale: options.locale ?? "zh-CN",
    topK: Math.max(1, Number(options.semanticTopK ?? 8)),
    required: false
  };
}

export class RetrievalPlanner {
  constructor(options = {}) {
    this.options = options;
  }

  plan(envelope, overrides = {}) {
    const validation = validateIntentEnvelope(envelope);
    if (!validation.valid) throw new TypeError(`Invalid IntentEnvelope: ${validation.errors.join("; ")}`);
    const options = { ...this.options, ...overrides };
    if (envelope.needsClarification || envelope.confidence < Number(options.minimumConfidence ?? 0.66)) {
      return createRetrievalPlan({
        intent: envelope.intent,
        evidenceBudget: options.evidenceBudget ?? DEFAULT_EVIDENCE_BUDGET,
        needsClarification: true,
        warnings: [...envelope.warnings, "intent_or_entity_confidence_insufficient"]
      });
    }

    const conclusionSpec = specForEnvelope(envelope);
    const structuredQueries = [];
    if ([
      "unit_build_rankings", "unit_build_completion", "unit_best_3_items", "unit_item_rankings",
      "unit_item_comparison", "unit_item_availability", "unit_emblem_rankings"
    ].includes(envelope.intent)) {
      if (envelope.constraints.compMention) {
        structuredQueries.push(unitCompCandidatesQuery(envelope));
      }
      structuredQueries.push(unitBuildQuery(envelope));
    } else if (["comp_rankings", "comp_trends", "comp_analysis"].includes(envelope.intent)) {
      structuredQueries.push(compQuery(envelope));
    } else if (DETAIL_OPERATIONS[envelope.intent]) {
      const type = envelope.intent.replace("_details", "");
      structuredQueries.push({
        id: `structured:${DETAIL_OPERATIONS[envelope.intent]}`,
        source: "official_catalog",
        operation: DETAIL_OPERATIONS[envelope.intent],
        params: { apiName: entity(envelope, type)?.apiName ?? null },
        required: true
      });
    } else {
      throw new RangeError(`Unsupported retrieval intent: ${envelope.intent}`);
    }

    const semanticQueries = shouldRetrieveSemantics(envelope, options)
      ? [semanticQuery(envelope, options)]
      : [];
    return createRetrievalPlan({
      intent: envelope.intent,
      structuredQueries,
      semanticQueries,
      evidenceBudget: options.evidenceBudget ?? DEFAULT_EVIDENCE_BUDGET,
      requiredEvidence: flattenedEvidence(conclusionSpec),
      promptKey: conclusionSpec?.prompt?.key ?? null,
      warnings: envelope.warnings
    });
  }
}

export function createRetrievalPlanner(options = {}) {
  return new RetrievalPlanner(options);
}

export function planRetrieval(envelope, options = {}) {
  return createRetrievalPlanner(options).plan(envelope);
}

export { DEFAULT_EVIDENCE_BUDGET, PROMPT_KEYS, REQUIRED_EVIDENCE, RETRIEVAL_PLAN_SCHEMA_VERSION };
