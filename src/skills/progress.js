import { SKILL_PROGRESS_SCHEMA_VERSION, validateSkillProgress } from "./contracts.js";

export function projectSkillProgress({ skill, context, facetEvidence = {} }) {
  const requiredFacets = skill.facets.filter(({ requirement }) => requirement === "required").map(({ id }) => id);
  const coveredFacets = [];
  const missingFacets = [];
  const unsupportedFacets = [];
  const unavailable = new Set(context.dataAvailability.filter(({ status }) => status !== "available").map(({ dependencyId }) => dependencyId));
  for (const facetId of requiredFacets) {
    const uses = Array.isArray(facetEvidence[facetId]) ? facetEvidence[facetId] : [];
    if (uses.length > 0) {
      coveredFacets.push({
        facetId,
        evidenceIds: [...new Set(uses.map(({ evidenceId }) => evidenceId).filter(Boolean))],
        tierSummary: [...new Set(uses.map(({ tier }) => tier).filter(Boolean))].sort()
      });
    } else if (unavailable.size === context.dataAvailability.length) {
      unsupportedFacets.push({ facetId, reasonCode: "data_unavailable" });
    } else {
      missingFacets.push(facetId);
    }
  }
  const status = missingFacets.length === 0 && unsupportedFacets.length === 0
    ? "complete"
    : missingFacets.length === 0 && skill.completionPolicy.allowQualifiedIncomplete
      ? "qualified_incomplete"
      : "in_progress";
  return validateSkillProgress({
    schemaVersion: SKILL_PROGRESS_SCHEMA_VERSION,
    skillId: skill.id,
    requiredFacets,
    coveredFacets,
    missingFacets,
    unsupportedFacets,
    status
  });
}
