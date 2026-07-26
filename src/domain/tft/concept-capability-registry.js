export const CONCEPT_CAPABILITY_REGISTRY_VERSION = "concept-capability-registry.v1";

const DEFINITIONS = Object.freeze([
  Object.freeze({
    conceptId: "concept.strategy.fast9_nine_five",
    supportedActions: Object.freeze(["recommend", "rank", "search"]),
    tool: "comps_rankings",
    argumentTemplate: Object.freeze({
      strategy: "fast9",
      patch: "current"
    }),
    resultPolicy: Object.freeze({
      type: "filter_by_strategy",
      argument: "strategy",
      collectionPath: "candidates",
      filterPath: "strategy",
      outputPath: "rankings.top4Rate",
      clearPaths: Object.freeze([
        "rankings.winRate",
        "rankings.winShare",
        "rankings.avgPlacement",
        "rankings.popularity"
      ]),
      sort: Object.freeze([
        Object.freeze({ path: "stats.top4Rate", direction: "desc" }),
        Object.freeze({ path: "stats.winRate", direction: "desc" }),
        Object.freeze({ path: "stats.games", direction: "desc" }),
        Object.freeze({ path: "compId", direction: "asc" })
      ]),
      limitArgument: "limit",
      defaultLimit: 3,
      neverResolveToSingleResult: true,
      neverResolveToSingleComp: true
    }),
    evidenceContract: Object.freeze({
      type: "composition_rankings",
      source: "metatft",
      patchScope: "current",
      requiredFields: Object.freeze(["source", "updatedAt"])
    }),
    finalEvidenceContract: Object.freeze({
      required: true,
      type: "composition_rankings",
      source: "metatft",
      collectionPath: "rankings.top4Rate",
      requiredFields: Object.freeze([
        "compId",
        "strategy",
        "stats.games",
        "stats.top4Rate",
        "stats.winRate",
        "stats.avgPlacement"
      ]),
      envelopeRequiredFields: Object.freeze(["source.updatedAt"]),
      allowEmpty: true,
      allowModelGeneratedStatistics: false
    })
  })
]);

const BY_ID = new Map(DEFINITIONS.map((definition) => [
  definition.conceptId,
  definition
]));

export function listConceptCapabilities() {
  return DEFINITIONS.map((definition) => structuredClone(definition));
}

export function getConceptCapabilityDefinition(conceptId) {
  const definition = BY_ID.get(String(conceptId));
  return definition ? structuredClone(definition) : null;
}
