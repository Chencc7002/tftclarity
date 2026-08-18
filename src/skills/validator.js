import { SKILL_COMPLETION_SCHEMA_VERSION, validateSkillCompletionResult } from "./contracts.js";

export function validateSkillCompletion({ skill, progress }) {
  const missingFacets = [
    ...progress.missingFacets,
    ...progress.unsupportedFacets.map(({ facetId }) => facetId)
  ];
  const qualified = progress.missingFacets.length === 0
    && progress.unsupportedFacets.length > 0
    && skill.completionPolicy.allowQualifiedIncomplete;
  const complete = missingFacets.length === 0;
  return validateSkillCompletionResult({
    schemaVersion: SKILL_COMPLETION_SCHEMA_VERSION,
    valid: complete || qualified,
    status: complete ? "complete" : qualified ? "qualified_incomplete" : "rejected",
    errors: complete || qualified ? [] : ["required_facet_coverage_missing"],
    missingFacets,
    reasonCodes: complete ? ["required_facets_covered"] : qualified ? ["required_data_unavailable"] : ["recoverable_required_facets_missing"]
  });
}
