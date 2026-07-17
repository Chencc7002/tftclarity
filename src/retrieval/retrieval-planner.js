import {
  RETRIEVAL_PLAN_SCHEMA_VERSION,
  createRetrievalPlan,
  validateIntentEnvelope
} from "./contracts.js";

const DEFAULT_EVIDENCE_BUDGET = Object.freeze({ maxItems: 40, maxCharacters: 16000 });
const PROMPT_KEYS = Object.freeze({
  unit_build_rankings: "unit-build-rankings",
  unit_build_completion: "unit-build-rankings",
  unit_best_3_items: "unit-build-rankings",
  unit_item_rankings: "unit-item-rankings",
  unit_item_comparison: "unit-item-comparison",
  unit_emblem_rankings: "unit-emblem-rankings",
  comp_rankings: "comp-rankings",
  comp_trends: "comp-trends"
});

const REQUIRED_EVIDENCE = Object.freeze({
  unit_build_rankings: ["visible_builds", "games", "avgPlacement", "top4Rate", "winRate"],
  unit_build_completion: ["visible_builds", "lockedItems", "games", "avgPlacement", "top4Rate", "winRate"],
  unit_best_3_items: ["visible_builds", "games", "avgPlacement", "top4Rate", "winRate"],
  unit_item_rankings: ["visible_items", "coverage", "games", "avgPlacement", "top4Rate", "winRate"],
  unit_item_comparison: ["comparison_options", "exclusive_samples", "winner", "games", "avgPlacement", "top4Rate", "winRate"],
  unit_emblem_rankings: ["visible_emblems", "games", "avgPlacement", "top4Rate", "winRate"],
  comp_rankings: ["visible_comps", "games", "avgPlacement", "top4Rate", "winRate", "pickRate"],
  comp_trends: ["visible_trends", "placementImprovement", "pickRate", "games", "trendScore"]
});

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

function compQuery(envelope) {
  const constraints = envelope.constraints;
  return {
    id: envelope.intent === "comp_trends" ? "structured:comp_trends" : "structured:comp_rankings",
    source: "metatft",
    operation: envelope.intent === "comp_trends" ? "comps_trends" : "comps_rankings",
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
  const documentTypes = envelope.intent === "comp_trends" || envelope.intent === "comp_rankings"
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

    const structuredQueries = [];
    if ([
      "unit_build_rankings", "unit_build_completion", "unit_best_3_items", "unit_item_rankings",
      "unit_item_comparison", "unit_emblem_rankings"
    ].includes(envelope.intent)) {
      structuredQueries.push(unitBuildQuery(envelope));
    } else if (["comp_rankings", "comp_trends"].includes(envelope.intent)) {
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
      requiredEvidence: REQUIRED_EVIDENCE[envelope.intent] ?? [],
      promptKey: PROMPT_KEYS[envelope.intent] ?? null,
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
