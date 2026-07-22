import { existsSync } from "node:fs";

export const CONCLUSION_SPEC_SCHEMA_VERSION = "conclusion-spec.v1";
export const CONCLUSION_SPEC_REGISTRY_VERSION = "conclusion-spec-registry.v1";
export const CONCLUSION_VALIDATOR_VERSION = "conclusion-validator.v3";

const VALID_EVIDENCE_REQUIREMENTS = new Set([
  "visible_builds", "visible_items", "visible_emblems", "visible_comps", "visible_trends",
  "comparison_options", "exclusive_samples", "lockedItems", "target_item", "target_comp",
  "games", "avgPlacement", "top4Rate", "winRate", "pickRate", "coverage", "winner",
  "placementImprovement", "trendScore", "historicalComparison", "officialPatch",
  "metatft_fact", "historical_fact", "official_patch", "sample_status"
]);

const VALID_VALIDATION_KEYS = new Set([
  "preserveEvidenceStatus", "causality", "mentionLowSample", "mentionStale",
  "focus", "requireComparisonTargets", "currentFactIsNotHistory"
]);

const VALID_FALLBACK_RENDERERS = new Set([
  "unit_build_rankings", "unit_item_rankings", "unit_emblem_rankings",
  "unit_item_comparison", "comp_rankings", "comp_trends", "comp_analysis"
]);

const PROMPT_FILES = new Set([
  "unit-build-rankings.md", "unit-item-rankings.md", "unit-emblem-rankings.md",
  "unit-item-comparison.md", "comp-rankings.md", "comp-trends.md", "comp-analysis.md"
]);

const DEFAULT_RULES = Object.freeze({
  factsMustComeFromEvidence: true,
  forbidCausalClaims: true,
  preserveEvidenceStatus: true
});

function frozen(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

function prompt(key, version, file) {
  return { key, version, file };
}

function spec({
  id, intent, questionType = "default", resultTypes = [intent], prompt: promptValue,
  requiredAnswerDimensions, requiredEvidence, validationRules = {}, generationRules = {}, fallback,
  priority = 100, version = 1, enabled = true, forbiddenClaims = []
}) {
  return {
    schemaVersion: CONCLUSION_SPEC_SCHEMA_VERSION,
    id,
    version,
    enabled,
    priority,
    match: { intent, questionType, resultTypes },
    prompt: promptValue,
    requiredAnswerDimensions,
    requiredEvidence,
    forbiddenClaims,
    validationRules: { ...validationRules },
    generationRules: { ...DEFAULT_RULES, ...generationRules },
    fallback: { renderer: fallback }
  };
}

const BUILD_EVIDENCE = ["visible_builds", "games", "avgPlacement", "top4Rate", "winRate", "sample_status"];
const ITEM_EVIDENCE = ["visible_items", "coverage", "games", "avgPlacement", "top4Rate", "winRate", "sample_status"];
const COMP_EVIDENCE = ["visible_comps", "games", "avgPlacement", "top4Rate", "winRate", "pickRate", "sample_status"];

const RAW_SPECS = [
  spec({
    id: "unit_build_rankings.default", intent: "unit_build_rankings",
    prompt: prompt("unit-build-rankings", "unit-build-rankings.v3", "unit-build-rankings.md"),
    requiredAnswerDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
    requiredEvidence: {
      build_performance: ["visible_builds", "games", "avgPlacement", "top4Rate", "winRate"],
      core_item_tendency: ["visible_builds"], sample_risk: ["sample_status"]
    },
    fallback: "unit_build_rankings"
  }),
  spec({
    id: "unit_build_completion.default", intent: "unit_build_completion",
    prompt: prompt("unit-build-rankings", "unit-build-rankings.v3", "unit-build-rankings.md"),
    requiredAnswerDimensions: ["completion_options", "locked_item_compatibility", "sample_risk"],
    requiredEvidence: {
      completion_options: BUILD_EVIDENCE, locked_item_compatibility: ["visible_builds", "lockedItems"],
      sample_risk: ["sample_status"]
    }, fallback: "unit_build_rankings"
  }),
  spec({
    id: "unit_best_3_items.default", intent: "unit_best_3_items",
    prompt: prompt("unit-build-rankings", "unit-build-rankings.v3", "unit-build-rankings.md"),
    requiredAnswerDimensions: ["build_performance", "core_item_tendency", "sample_risk"],
    requiredEvidence: {
      build_performance: BUILD_EVIDENCE, core_item_tendency: ["visible_builds"], sample_risk: ["sample_status"]
    }, fallback: "unit_build_rankings"
  }),
  spec({
    id: "unit_item_rankings.default", intent: "unit_item_rankings",
    prompt: prompt("unit-item-rankings", "unit-item-rankings.v3", "unit-item-rankings.md"),
    requiredAnswerDimensions: ["item_performance_ranking", "metric_reliability", "sample_risk"],
    requiredEvidence: {
      item_performance_ranking: ITEM_EVIDENCE, metric_reliability: ["coverage", "games"], sample_risk: ["sample_status"]
    }, fallback: "unit_item_rankings",
    validationRules: { focus: "item_ranking_not_full_build" }
  }),
  // Stage-five extension: this variant reuses the existing item evidence and engine.
  spec({
    id: "unit_item_rankings.item_performance", intent: "unit_item_rankings", questionType: "item_performance",
    prompt: prompt("unit-item-rankings", "unit-item-rankings.v3", "unit-item-rankings.md"),
    requiredAnswerDimensions: ["target_item_performance", "ranking_context", "sample_risk"],
    requiredEvidence: {
      target_item_performance: ["target_item", "games", "avgPlacement", "top4Rate", "winRate"],
      ranking_context: ["visible_items", "coverage"], sample_risk: ["sample_status"]
    }, fallback: "unit_item_rankings", priority: 200,
    validationRules: { focus: "item_performance_not_full_build" }
  }),
  spec({
    id: "unit_emblem_rankings.default", intent: "unit_emblem_rankings",
    prompt: prompt("unit-emblem-rankings", "unit-emblem-rankings.v2", "unit-emblem-rankings.md"),
    requiredAnswerDimensions: ["emblem_performance_ranking", "metric_reliability", "sample_risk"],
    requiredEvidence: {
      emblem_performance_ranking: ["visible_emblems", "games", "avgPlacement", "top4Rate", "winRate"],
      metric_reliability: ["games"], sample_risk: ["sample_status"]
    }, fallback: "unit_emblem_rankings"
  }),
  spec({
    id: "unit_item_comparison.default", intent: "unit_item_comparison",
    prompt: prompt("unit-item-comparison", "unit-item-comparison.v2", "unit-item-comparison.md"),
    requiredAnswerDimensions: ["comparison_result", "comparison_metrics", "sample_risk"],
    requiredEvidence: {
      comparison_result: ["comparison_options", "winner"],
      comparison_metrics: ["exclusive_samples", "games", "avgPlacement", "top4Rate", "winRate"],
      sample_risk: ["sample_status"]
    }, fallback: "unit_item_comparison",
    validationRules: { requireComparisonTargets: true }
  }),
  spec({
    id: "comp_rankings.default", intent: "comp_rankings",
    prompt: prompt("comp-rankings", "comp-rankings.v2", "comp-rankings.md"),
    requiredAnswerDimensions: ["ranking_leaders", "requested_metrics", "sample_risk"],
    requiredEvidence: {
      ranking_leaders: COMP_EVIDENCE, requested_metrics: ["visible_comps"], sample_risk: ["sample_status"]
    }, fallback: "comp_rankings"
  }),
  spec({
    id: "comp_trends.default", intent: "comp_trends",
    prompt: prompt("comp-trends", "comp-trends.v2", "comp-trends.md"),
    requiredAnswerDimensions: ["current_popularity", "placement_trend", "sample_risk"],
    requiredEvidence: {
      current_popularity: ["visible_trends", "pickRate"],
      placement_trend: ["visible_trends", "placementImprovement", "trendScore"], sample_risk: ["sample_status"]
    }, fallback: "comp_trends",
    validationRules: { focus: "popularity_and_trend_not_strength" }
  })
];

const ANALYSIS_VARIANTS = {
  meta_fit: {
    dimensions: ["current_performance", "meta_fit", "sample_risk"],
    evidence: { current_performance: COMP_EVIDENCE, meta_fit: ["metatft_fact"], sample_risk: ["sample_status"] }
  },
  cause_up: {
    dimensions: ["current_performance", "historical_change", "possible_causes"],
    evidence: { current_performance: COMP_EVIDENCE, historical_change: ["historical_fact"], possible_causes: ["historical_fact", "official_patch"] }
  },
  cause_down: {
    dimensions: ["current_performance", "historical_change", "possible_causes"],
    evidence: { current_performance: COMP_EVIDENCE, historical_change: ["historical_fact"], possible_causes: ["historical_fact", "official_patch"] }
  },
  popularity_drop: {
    dimensions: ["current_popularity", "historical_popularity_change", "possible_causes"],
    evidence: { current_popularity: ["metatft_fact", "pickRate"], historical_popularity_change: ["historical_fact"], possible_causes: ["historical_fact", "official_patch"] }
  },
  force: {
    dimensions: ["current_performance", "force_play_risk", "sample_risk"],
    evidence: { current_performance: COMP_EVIDENCE, force_play_risk: ["metatft_fact"], sample_risk: ["sample_status"] }
  },
  goal_fit: {
    dimensions: ["current_performance", "goal_fit", "sample_risk"],
    evidence: { current_performance: COMP_EVIDENCE, goal_fit: ["metatft_fact"], sample_risk: ["sample_status"] }
  },
  contested: {
    dimensions: ["current_popularity", "contest_level", "sample_risk"],
    evidence: { current_popularity: ["metatft_fact", "pickRate"], contest_level: ["metatft_fact"], sample_risk: ["sample_status"] }
  },
  viability: {
    dimensions: ["current_performance", "viability", "sample_risk"],
    evidence: { current_performance: COMP_EVIDENCE, viability: ["metatft_fact"], sample_risk: ["sample_status"] }
  }
};

for (const [questionType, value] of Object.entries(ANALYSIS_VARIANTS)) {
  RAW_SPECS.push(spec({
    id: `comp_analysis.${questionType}`, intent: "comp_analysis", questionType,
    prompt: prompt("comp-analysis", "comp-analysis.v2", "comp-analysis.md"),
    requiredAnswerDimensions: value.dimensions, requiredEvidence: value.evidence,
    forbiddenClaims: ["certain_causality", "historical_change_without_history"],
    validationRules: {
      preserveEvidenceStatus: true, causality: "possible_relationship_only",
      mentionLowSample: "when_present", mentionStale: "when_present", currentFactIsNotHistory: true,
      focus: questionType === "popularity_drop" ? "popularity_not_strength" : "question_type"
    },
    fallback: "comp_analysis"
  }));
}

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateSpecShape(value, options = {}) {
  const errors = [];
  if (!object(value)) return ["spec must be an object"];
  if (value.schemaVersion !== CONCLUSION_SPEC_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CONCLUSION_SPEC_SCHEMA_VERSION}`);
  if (!value.id || typeof value.id !== "string") errors.push("id is required");
  if (!Number.isInteger(value.version) || value.version < 1) errors.push("version must be a positive integer");
  if (typeof value.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!object(value.match) || !value.match.intent || !value.match.questionType || !Array.isArray(value.match.resultTypes) || value.match.resultTypes.length === 0) {
    errors.push("match requires intent, questionType and resultTypes");
  }
  if (!object(value.prompt) || !value.prompt.key || !value.prompt.file || !value.prompt.version) errors.push("prompt requires key, file and version");
  const promptExists = options.promptExists ?? ((file) => PROMPT_FILES.has(file)
    && existsSync(new URL(`./prompts/conclusion-intents/${file}`, import.meta.url)));
  if (value.prompt?.file && !promptExists(value.prompt.file)) errors.push(`prompt file is not registered or missing: ${value.prompt.file}`);
  if (!Array.isArray(value.requiredAnswerDimensions) || value.requiredAnswerDimensions.length === 0) errors.push("requiredAnswerDimensions must not be empty");
  if (!object(value.requiredEvidence)) errors.push("requiredEvidence must be an object");
  for (const dimension of value.requiredAnswerDimensions ?? []) {
    const requirements = value.requiredEvidence?.[dimension];
    if (!Array.isArray(requirements) || requirements.length === 0) errors.push(`requiredEvidence missing for dimension: ${dimension}`);
    for (const requirement of requirements ?? []) {
      if (!VALID_EVIDENCE_REQUIREMENTS.has(requirement)) errors.push(`unsupported requiredEvidence: ${requirement}`);
    }
  }
  for (const key of Object.keys(value.validationRules ?? {})) {
    if (!VALID_VALIDATION_KEYS.has(key)) errors.push(`unsupported validation rule: ${key}`);
  }
  if (!VALID_FALLBACK_RENDERERS.has(value.fallback?.renderer)) errors.push(`unsupported fallback renderer: ${value.fallback?.renderer}`);
  return errors;
}

export class ConclusionSpecRegistryError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ConclusionSpecRegistryError";
    this.code = options.code ?? "invalid_conclusion_spec_registry";
    this.details = options.details ?? [];
  }
}

export class ConclusionSpecRegistry {
  constructor(specs = RAW_SPECS, options = {}) {
    this.schemaVersion = CONCLUSION_SPEC_REGISTRY_VERSION;
    this.specs = specs.map((entry) => frozen(structuredClone(entry)));
    this.byId = new Map();
    const errors = [];
    for (const entry of this.specs) {
      const entryErrors = validateSpecShape(entry, options).map((message) => `${entry?.id ?? "(missing)"}: ${message}`);
      errors.push(...entryErrors);
      if (this.byId.has(entry.id)) errors.push(`${entry.id}: duplicate id`);
      this.byId.set(entry.id, entry);
    }
    const matchKeys = new Map();
    for (const entry of this.specs.filter((candidate) => candidate.enabled)) {
      for (const resultType of entry.match.resultTypes) {
        const key = `${entry.match.intent}|${entry.match.questionType}|${resultType}|${entry.priority}`;
        if (matchKeys.has(key)) errors.push(`${entry.id}: ambiguous match with ${matchKeys.get(key)}`);
        else matchKeys.set(key, entry.id);
      }
    }
    if (errors.length) throw new ConclusionSpecRegistryError("ConclusionSpec registry compilation failed", { details: errors });
    frozen(this.specs);
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  supportsIntent(intent) {
    return this.specs.some((entry) => entry.enabled && entry.match.intent === intent);
  }

  resolve({ intent, questionType = "default", resultType = intent } = {}) {
    const matches = this.specs.filter((entry) => entry.enabled
      && entry.match.intent === intent
      && entry.match.questionType === questionType
      && entry.match.resultTypes.includes(resultType));
    if (matches.length === 0) {
      throw new ConclusionSpecRegistryError(`No exact ConclusionSpec match for ${intent}/${questionType}/${resultType}`, {
        code: "unregistered_conclusion_spec"
      });
    }
    const highest = Math.max(...matches.map((entry) => entry.priority));
    const winners = matches.filter((entry) => entry.priority === highest);
    if (winners.length !== 1) {
      throw new ConclusionSpecRegistryError(`Ambiguous ConclusionSpec match for ${intent}/${questionType}/${resultType}`, {
        code: "ambiguous_conclusion_spec", details: winners.map((entry) => entry.id)
      });
    }
    return winners[0];
  }

  list({ enabled } = {}) {
    return this.specs.filter((entry) => enabled === undefined || entry.enabled === enabled);
  }
}

export function deriveConclusionQuestionType(result = {}, intentEnvelope = null) {
  return result?.analysis?.questionType
    ?? result?.query?.analysis?.questionType
    ?? intentEnvelope?.questionType
    ?? (result?.query?.performanceItem ? "item_performance" : "default");
}

export function createConclusionSpecRegistry(specs, options = {}) {
  return new ConclusionSpecRegistry(specs ?? RAW_SPECS, options);
}

export const CONCLUSION_SPEC_REGISTRY = createConclusionSpecRegistry();
export const CONCLUSION_SPECS = CONCLUSION_SPEC_REGISTRY.specs;
export const SUPPORTED_CONCLUSION_INTENTS = frozen([...new Set(CONCLUSION_SPECS.map((entry) => entry.match.intent))]);

export { RAW_SPECS as DEFAULT_CONCLUSION_SPECS };
