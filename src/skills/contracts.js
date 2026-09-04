export const SKILL_SCHEMA_VERSION = "agent-skill.v1";
export const SKILL_SELECTION_SCHEMA_VERSION = "skill-selection.v1";
export const SKILL_DATA_AVAILABILITY_SCHEMA_VERSION = "skill-data-availability.v1";
export const SKILL_CONTEXT_SCHEMA_VERSION = "skill-context.v1";
export const CLAIM_EVIDENCE_USE_SCHEMA_VERSION = "claim-evidence-use.v1";
export const SKILL_PROGRESS_SCHEMA_VERSION = "skill-progress.v1";
export const SKILL_COMPLETION_SCHEMA_VERSION = "skill-completion-validation.v1";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, label) {
  assertPlainObject(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new TypeError(`${label} has unknown fields: ${unknown.join(", ")}`);
}

function assertStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  if (value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new TypeError(`${label} entries must be non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} entries must be unique`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function validateSkillDefinition(input) {
  assertExactKeys(input, [
    "schemaVersion", "id", "version", "description", "triggers", "exclusions",
    "dataDependencies", "requiredCapabilities", "optionalCapabilities", "allowedTools",
    "facets", "evidencePolicy", "instructions", "completionPolicy"
  ], "SkillDefinition");
  if (input.schemaVersion !== SKILL_SCHEMA_VERSION) throw new TypeError(`SkillDefinition schemaVersion must be ${SKILL_SCHEMA_VERSION}`);
  if (!ID_PATTERN.test(String(input.id ?? ""))) throw new TypeError("SkillDefinition id must be snake_case");
  if (!SEMVER_PATTERN.test(String(input.version ?? ""))) throw new TypeError("SkillDefinition version must be semantic version x.y.z");
  if (!String(input.description ?? "").trim()) throw new TypeError("SkillDefinition description is required");

  assertExactKeys(input.triggers, ["domains", "actions", "goals", "requiredEntityTypes", "expectedOutputsAny"], "SkillDefinition.triggers");
  for (const key of ["domains", "actions", "goals", "requiredEntityTypes", "expectedOutputsAny"]) {
    assertStringArray(input.triggers[key], `SkillDefinition.triggers.${key}`, { allowEmpty: false });
  }
  assertExactKeys(input.exclusions, ["goals"], "SkillDefinition.exclusions");
  assertStringArray(input.exclusions.goals, "SkillDefinition.exclusions.goals");

  if (!Array.isArray(input.dataDependencies) || input.dataDependencies.length === 0) throw new TypeError("SkillDefinition.dataDependencies must be non-empty");
  for (const dependency of input.dataDependencies) {
    assertExactKeys(dependency, ["id", "requirement"], "SkillDefinition.dataDependency");
    if (!ID_PATTERN.test(String(dependency.id ?? ""))) throw new TypeError("SkillDefinition dependency id is invalid");
    if (!["required", "optional"].includes(dependency.requirement)) throw new TypeError("SkillDefinition dependency requirement is invalid");
  }
  if (new Set(input.dataDependencies.map(({ id }) => id)).size !== input.dataDependencies.length) throw new TypeError("SkillDefinition dependency ids must be unique");

  for (const key of ["requiredCapabilities", "optionalCapabilities", "allowedTools", "instructions"]) {
    assertStringArray(input[key], `SkillDefinition.${key}`, { allowEmpty: key !== "requiredCapabilities" && key !== "allowedTools" });
  }
  if (!Array.isArray(input.facets) || input.facets.length === 0) throw new TypeError("SkillDefinition.facets must be non-empty");
  for (const facet of input.facets) {
    assertExactKeys(facet, ["id", "requirement", "dataDependenciesAny"], "SkillDefinition.facet");
    if (!ID_PATTERN.test(String(facet.id ?? ""))) throw new TypeError("SkillDefinition facet id is invalid");
    if (!["required", "required_if_supported", "optional"].includes(facet.requirement)) throw new TypeError("SkillDefinition facet requirement is invalid");
    if (facet.dataDependenciesAny !== undefined) {
      assertStringArray(facet.dataDependenciesAny, "SkillDefinition.facet.dataDependenciesAny", { allowEmpty: false });
      if (facet.dataDependenciesAny.some((id) => !input.dataDependencies.some((dependency) => dependency.id === id))) {
        throw new TypeError("SkillDefinition facet references an undeclared dependency");
      }
    }
  }
  if (new Set(input.facets.map(({ id }) => id)).size !== input.facets.length) throw new TypeError("SkillDefinition facet ids must be unique");

  assertExactKeys(input.evidencePolicy, ["minimumTierByFacet", "requireFreshForCurrentClaims", "distinguishFactAdviceInference", "neverTreatAbsenceAsNegativeEvidence"], "SkillDefinition.evidencePolicy");
  assertPlainObject(input.evidencePolicy.minimumTierByFacet, "SkillDefinition.evidencePolicy.minimumTierByFacet");
  for (const key of ["requireFreshForCurrentClaims", "distinguishFactAdviceInference", "neverTreatAbsenceAsNegativeEvidence"]) {
    if (typeof input.evidencePolicy[key] !== "boolean") throw new TypeError(`SkillDefinition.evidencePolicy.${key} must be boolean`);
  }
  assertExactKeys(input.completionPolicy, ["allowQualifiedIncomplete", "rejectRecoverableMissingRequiredFacets", "neverInventMissingEvidence"], "SkillDefinition.completionPolicy");
  for (const key of ["allowQualifiedIncomplete", "rejectRecoverableMissingRequiredFacets", "neverInventMissingEvidence"]) {
    if (typeof input.completionPolicy[key] !== "boolean") throw new TypeError(`SkillDefinition.completionPolicy.${key} must be boolean`);
  }
  if (!input.completionPolicy.neverInventMissingEvidence) throw new TypeError("SkillDefinition cannot permit invented Evidence");
  return deepFreeze(structuredClone(input));
}

export function validateClaimEvidenceUse(input) {
  assertExactKeys(input, ["schemaVersion", "claimId", "evidenceId", "tier", "claimKind", "role", "reasonCode", "supportsFacets", "freshnessStatus", "provenance"], "ClaimEvidenceUse");
  if (input.schemaVersion !== CLAIM_EVIDENCE_USE_SCHEMA_VERSION) throw new TypeError(`ClaimEvidenceUse schemaVersion must be ${CLAIM_EVIDENCE_USE_SCHEMA_VERSION}`);
  for (const key of ["claimId", "evidenceId", "reasonCode"]) if (!String(input[key] ?? "").trim()) throw new TypeError(`ClaimEvidenceUse ${key} is required`);
  // Tier is a closed category, not an ordinal validity/confidence score.
  if (!/^[A-E]$/u.test(input.tier)) throw new TypeError("ClaimEvidenceUse tier is invalid");
  if (!["current_fact", "source_recommendation", "mechanism", "heuristic", "inference"].includes(input.claimKind)) throw new TypeError("ClaimEvidenceUse claimKind is invalid");
  if (!["supports", "qualifies", "context"].includes(input.role)) throw new TypeError("ClaimEvidenceUse role is invalid");
  // This annotation is non-authoritative: callers may only derive it from, or
  // further restrict, the Evidence-owned temporal/freshness qualification.
  if (!["fresh", "historical", "stale", "not_applicable"].includes(input.freshnessStatus)) throw new TypeError("ClaimEvidenceUse freshnessStatus is invalid");
  if (!["tool", "source_guide", "manual_overlay", "manual_knowledge", "model_inference"].includes(input.provenance)) throw new TypeError("ClaimEvidenceUse provenance is invalid");
  assertStringArray(input.supportsFacets, "ClaimEvidenceUse.supportsFacets");
  return deepFreeze(structuredClone(input));
}

export function freezeSkillContract(input) {
  return deepFreeze(structuredClone(input));
}

// Policies must be synchronous, deterministic server code. No model result or
// asynchronous retriever is accepted as an approval decision.
export function runSkillPolicy(policy, input) {
  if (typeof policy !== "function" || policy.constructor?.name === "AsyncFunction") return null;
  try {
    const result = policy(input);
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export function validateSkillSelection(input) {
  assertExactKeys(input, ["schemaVersion", "status", "mode", "selected", "alternatives", "reasonCodes", "semanticFallback"], "SkillSelection");
  if (input.schemaVersion !== SKILL_SELECTION_SCHEMA_VERSION) throw new TypeError(`SkillSelection schemaVersion must be ${SKILL_SELECTION_SCHEMA_VERSION}`);
  if (!["selected", "none", "ambiguous"].includes(input.status) || input.mode !== "deterministic") throw new TypeError("SkillSelection status or mode is invalid");
  if (!Array.isArray(input.alternatives)) throw new TypeError("SkillSelection alternatives must be an array");
  assertStringArray(input.reasonCodes, "SkillSelection.reasonCodes");
  assertExactKeys(input.semanticFallback, ["eligible", "invoked"], "SkillSelection.semanticFallback");
  if (typeof input.semanticFallback.eligible !== "boolean" || typeof input.semanticFallback.invoked !== "boolean") throw new TypeError("SkillSelection semanticFallback flags must be boolean");
  if (input.status === "selected") {
    assertExactKeys(input.selected, ["skillId", "skillVersion", "score", "reasons"], "SkillSelection.selected");
    if (!String(input.selected.skillId ?? "").trim() || !SEMVER_PATTERN.test(String(input.selected.skillVersion ?? "")) || !Number.isFinite(input.selected.score)) throw new TypeError("SkillSelection selected summary is invalid");
    assertStringArray(input.selected.reasons, "SkillSelection.selected.reasons", { allowEmpty: false });
  } else if (input.selected !== null) {
    throw new TypeError("SkillSelection selected must be null unless selected");
  }
  return deepFreeze(structuredClone(input));
}

export function validateSkillDataAvailability(input) {
  assertExactKeys(input, ["schemaVersion", "dependencyId", "status", "reasonCode", "observedAt", "sourceIds"], "SkillDataAvailability");
  if (input.schemaVersion !== SKILL_DATA_AVAILABILITY_SCHEMA_VERSION) throw new TypeError(`SkillDataAvailability schemaVersion must be ${SKILL_DATA_AVAILABILITY_SCHEMA_VERSION}`);
  if (!String(input.dependencyId ?? "").trim() || !String(input.reasonCode ?? "").trim()) throw new TypeError("SkillDataAvailability identifiers are required");
  if (!["available", "unavailable", "stale", "unknown"].includes(input.status)) throw new TypeError("SkillDataAvailability status is invalid");
  const reasons = {
    available: ["available_registered_tool", "observed_data"],
    unavailable: ["source_unavailable", "source_exhausted", "empty_result", "field_unavailable"],
    stale: ["freshness_failed"],
    unknown: ["not_probed", "source_failed"]
  };
  if (!reasons[input.status].includes(input.reasonCode)) throw new TypeError("SkillDataAvailability reasonCode is invalid");
  if (input.observedAt !== null && (typeof input.observedAt !== "string" || Number.isNaN(Date.parse(input.observedAt)))) throw new TypeError("SkillDataAvailability observedAt is invalid");
  if (["observed_data", "source_failed", "source_exhausted", "empty_result", "field_unavailable", "freshness_failed"].includes(input.reasonCode) && input.observedAt === null) throw new TypeError("SkillDataAvailability observation requires observedAt");
  assertStringArray(input.sourceIds, "SkillDataAvailability.sourceIds");
  return deepFreeze(structuredClone(input));
}

export function validateSkillContext(input) {
  assertExactKeys(input, ["schemaVersion", "skillId", "skillVersion", "selection", "taskFrameSchemaVersion", "facets", "evidencePolicy", "instructions", "dataAvailability", "toolPolicy", "completionPolicy"], "SkillContext");
  if (input.schemaVersion !== SKILL_CONTEXT_SCHEMA_VERSION) throw new TypeError(`SkillContext schemaVersion must be ${SKILL_CONTEXT_SCHEMA_VERSION}`);
  if (!String(input.skillId ?? "").trim() || !SEMVER_PATTERN.test(String(input.skillVersion ?? "")) || input.taskFrameSchemaVersion !== "task-frame.v1") throw new TypeError("SkillContext identity is invalid");
  if (!Array.isArray(input.facets) || !Array.isArray(input.dataAvailability)) throw new TypeError("SkillContext facets and dataAvailability must be arrays");
  assertExactKeys(input.selection, ["skillId", "skillVersion", "score", "reasons"], "SkillContext.selection");
  if (input.selection.skillId !== input.skillId || input.selection.skillVersion !== input.skillVersion || !Number.isFinite(input.selection.score)) throw new TypeError("SkillContext selection does not match Skill identity");
  assertStringArray(input.selection.reasons, "SkillContext.selection.reasons", { allowEmpty: false });
  for (const facet of input.facets) {
    assertExactKeys(facet, ["id", "requirement", "dataDependenciesAny"], "SkillContext.facet");
    if (!String(facet.id ?? "").trim() || !["required", "required_if_supported", "optional"].includes(facet.requirement)) throw new TypeError("SkillContext facet is invalid");
    if (facet.dataDependenciesAny !== undefined) {
      assertStringArray(facet.dataDependenciesAny, "SkillContext.facet.dataDependenciesAny", { allowEmpty: false });
      if (facet.dataDependenciesAny.some((id) => !input.dataAvailability.some((entry) => entry.dependencyId === id))) throw new TypeError("SkillContext facet references an undeclared dependency");
    }
  }
  input.dataAvailability.forEach(validateSkillDataAvailability);
  assertStringArray(input.instructions, "SkillContext.instructions");
  assertExactKeys(input.evidencePolicy, ["minimumTierByFacet", "requireFreshForCurrentClaims", "distinguishFactAdviceInference", "neverTreatAbsenceAsNegativeEvidence"], "SkillContext.evidencePolicy");
  assertExactKeys(input.completionPolicy, ["allowQualifiedIncomplete", "rejectRecoverableMissingRequiredFacets", "neverInventMissingEvidence"], "SkillContext.completionPolicy");
  assertExactKeys(input.toolPolicy, ["skillAllowedTools", "runtimeAvailableTools", "effectiveTools"], "SkillContext.toolPolicy");
  for (const key of ["skillAllowedTools", "runtimeAvailableTools", "effectiveTools"]) assertStringArray(input.toolPolicy[key], `SkillContext.toolPolicy.${key}`);
  if (input.toolPolicy.effectiveTools.some((name) => !input.toolPolicy.skillAllowedTools.includes(name) || !input.toolPolicy.runtimeAvailableTools.includes(name))) throw new TypeError("SkillContext effectiveTools must be an intersection");
  return deepFreeze(structuredClone(input));
}

export function validateSkillProgress(input) {
  assertExactKeys(input, ["schemaVersion", "skillId", "requiredFacets", "coveredFacets", "missingFacets", "unsupportedFacets", "status"], "SkillProgress");
  if (input.schemaVersion !== SKILL_PROGRESS_SCHEMA_VERSION) throw new TypeError(`SkillProgress schemaVersion must be ${SKILL_PROGRESS_SCHEMA_VERSION}`);
  if (!String(input.skillId ?? "").trim() || !["in_progress", "complete", "qualified_incomplete"].includes(input.status)) throw new TypeError("SkillProgress identity or status is invalid");
  assertStringArray(input.requiredFacets, "SkillProgress.requiredFacets");
  assertStringArray(input.missingFacets, "SkillProgress.missingFacets");
  if (!Array.isArray(input.coveredFacets) || !Array.isArray(input.unsupportedFacets)) throw new TypeError("SkillProgress coverage fields must be arrays");
  for (const entry of input.coveredFacets) {
    assertExactKeys(entry, ["facetId", "evidenceIds", "tierSummary"], "SkillProgress.coveredFacet");
    if (!String(entry.facetId ?? "").trim()) throw new TypeError("SkillProgress coveredFacet facetId is required");
    assertStringArray(entry.evidenceIds, "SkillProgress.coveredFacet.evidenceIds", { allowEmpty: false });
    assertStringArray(entry.tierSummary, "SkillProgress.coveredFacet.tierSummary", { allowEmpty: false });
    if (entry.tierSummary.some((tier) => !/^[A-E]$/u.test(tier))) throw new TypeError("SkillProgress tier is invalid");
  }
  for (const entry of input.unsupportedFacets) {
    assertExactKeys(entry, ["facetId", "reasonCode"], "SkillProgress.unsupportedFacet");
    if (!String(entry.facetId ?? "").trim() || !String(entry.reasonCode ?? "").trim()) throw new TypeError("SkillProgress unsupportedFacet is invalid");
  }
  const partition = [...input.coveredFacets.map(({ facetId }) => facetId), ...input.missingFacets, ...input.unsupportedFacets.map(({ facetId }) => facetId)];
  if (new Set(partition).size !== partition.length || partition.length !== input.requiredFacets.length || partition.some((id) => !input.requiredFacets.includes(id))) throw new TypeError("SkillProgress facets must partition requiredFacets");
  const expectedStatus = input.missingFacets.length ? "in_progress" : input.unsupportedFacets.length ? "qualified_incomplete" : "complete";
  if (input.status !== expectedStatus && !(input.status === "in_progress" && input.unsupportedFacets.length)) throw new TypeError("SkillProgress status contradicts coverage");
  return deepFreeze(structuredClone(input));
}

export function validateSkillCompletionResult(input) {
  assertExactKeys(input, ["schemaVersion", "valid", "status", "errors", "missingFacets", "reasonCodes"], "SkillCompletionValidation");
  if (input.schemaVersion !== SKILL_COMPLETION_SCHEMA_VERSION) throw new TypeError(`SkillCompletionValidation schemaVersion must be ${SKILL_COMPLETION_SCHEMA_VERSION}`);
  if (typeof input.valid !== "boolean" || !["complete", "qualified_incomplete", "rejected"].includes(input.status)) throw new TypeError("SkillCompletionValidation result is invalid");
  for (const key of ["errors", "missingFacets", "reasonCodes"]) assertStringArray(input[key], `SkillCompletionValidation.${key}`);
  return deepFreeze(structuredClone(input));
}
