import { SKILL_SCHEMA_VERSION } from "../contracts.js";

export const UNIT_PLAY_GUIDANCE_SKILL = Object.freeze({
  schemaVersion: SKILL_SCHEMA_VERSION,
  id: "unit_play_guidance",
  version: "1.0.0",
  description: "Bounded professional coverage for how to play one resolved TFT champion.",
  triggers: Object.freeze({
    domains: Object.freeze(["tft"]),
    actions: Object.freeze(["recommend"]),
    goals: Object.freeze(["recommend_unit_play"]),
    requiredEntityTypes: Object.freeze(["champion"]),
    expectedOutputsAny: Object.freeze(["unit_play_guidance"])
  }),
  exclusions: Object.freeze({ goals: Object.freeze(["unit_build_rankings", "recommend_best_option"]) }),
  dataDependencies: Object.freeze([
    Object.freeze({ id: "official_tft_entity_catalog", requirement: "required" }),
    Object.freeze({ id: "current_unit_build_statistics", requirement: "required" }),
    Object.freeze({ id: "current_composition_statistics", requirement: "optional" }),
    Object.freeze({ id: "current_composition_tactical_details", requirement: "optional" }),
    Object.freeze({ id: "mechanism_knowledge_index", requirement: "optional" })
  ]),
  requiredCapabilities: Object.freeze(["unit_build_statistics"]),
  optionalCapabilities: Object.freeze(["composition_positioning", "composition_augment_references"]),
  allowedTools: Object.freeze(["entity_catalog_query", "unit_builds", "comps_rankings", "composition_tactical_details", "semantic_search"]),
  facets: Object.freeze([
    Object.freeze({ id: "unit_role", requirement: "required" }),
    Object.freeze({ id: "equipment_logic", requirement: "required" }),
    Object.freeze({ id: "composition_context", requirement: "required" }),
    Object.freeze({ id: "positioning", requirement: "required" }),
    Object.freeze({ id: "when_to_play", requirement: "optional" })
  ]),
  evidencePolicy: Object.freeze({
    minimumTierByFacet: Object.freeze({}),
    requireFreshForCurrentClaims: true,
    distinguishFactAdviceInference: true,
    neverTreatAbsenceAsNegativeEvidence: true
  }),
  instructions: Object.freeze([
    "Cover only facets supported by validated Evidence and qualify unavailable facets."
  ]),
  completionPolicy: Object.freeze({
    allowQualifiedIncomplete: true,
    rejectRecoverableMissingRequiredFacets: true,
    neverInventMissingEvidence: true
  })
});

