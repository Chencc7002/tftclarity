import { SKILL_COMPLETION_SCHEMA_VERSION, validateSkillProgress, validateSkillCompletionResult, runSkillPolicy } from "./contracts.js";
import { evaluateSkillProgress } from "./progress.js";

// Initial shadow telemetry only. This projection never authorizes finish.
export function projectSkillCompletion({ skill, progress }) {
  validateSkillProgress(progress);
  if (progress.skillId !== skill.id || JSON.stringify(progress.requiredFacets)
    !== JSON.stringify(skill.facets.filter(({ requirement }) => requirement !== "optional").map(({ id }) => id))) {
    throw new TypeError("Skill progress identity or requirements mismatch");
  }
  const missingFacets = [...progress.missingFacets, ...progress.unsupportedFacets.map(({ facetId }) => facetId)];
  const qualified = !progress.missingFacets.length && progress.unsupportedFacets.length > 0 && skill.completionPolicy.allowQualifiedIncomplete;
  const complete = !missingFacets.length;
  return validateSkillCompletionResult({
    schemaVersion: SKILL_COMPLETION_SCHEMA_VERSION,
    valid: complete || qualified,
    status: complete ? "complete" : qualified ? "qualified_incomplete" : "rejected",
    errors: complete || qualified ? [] : ["required_facet_coverage_missing"],
    missingFacets,
    reasonCodes: complete ? ["required_facets_covered"] : qualified ? ["required_data_unavailable"] : ["recoverable_required_facets_missing"]
  });
}

export function validateSkillCompletion(input) {
  const { skill, answer, citedEvidenceIds = [], answerFacets = [], assessAnswerFacet, finishValidation } = input;
  // Recompute from current Evidence, never trust a supplied progress summary.
  const { progress, acceptedUses: accepted } = evaluateSkillProgress(input);
  const projected = projectSkillCompletion({ skill, progress });
  const errors = [...projected.errors];
  const missing = new Set(projected.missingFacets);
  if (typeof answer !== "string" || !answer.trim()) errors.push("answer_required");
  // Caller composes existing action/finish/grounding validators for this exact
  // answer. A serialized/model-provided 'valid' flag is deliberately insufficient.
  const finish = runSkillPolicy(finishValidation, { answer, citedEvidenceIds, evidenceLedger: input.evidenceLedger });
  if (finish?.valid !== true) errors.push("existing_finish_validation_required");
  if (!Array.isArray(citedEvidenceIds) || citedEvidenceIds.some((id) => typeof id !== "string" || !input.evidenceLedger?.get?.(id))) errors.push("invalid_cited_evidence");
  if (!Array.isArray(answerFacets)) throw new TypeError("Skill answerFacets must be an array");
  const seen = new Set();
  for (const item of answerFacets) {
    const facet = skill.facets.find(({ id }) => id === item?.facetId);
    if (!facet || seen.has(item.facetId) || Object.keys(item).some((key) => !["facetId", "status", "text", "evidenceIds"].includes(key))) {
      errors.push("invalid_answer_facet");
      continue;
    }
    seen.add(item.facetId);
    const textPresent = typeof item.text === "string" && Boolean(item.text.trim()) && typeof answer === "string" && answer.includes(item.text);
    const uses = accepted.get(item.facetId);
    const unsupported = progress.unsupportedFacets.some(({ facetId }) => facetId === item.facetId)
      || (facet.requirement === "optional" && uses.length === 0);
    const ids = item.evidenceIds;
    const cited = Array.isArray(ids) && ids.every((id) => typeof id === "string" && Array.isArray(citedEvidenceIds) && citedEvidenceIds.includes(id));
    const supported = item.status === "supported" && cited && ids.length > 0
      && ids.every((id) => uses.some((use) => use.evidenceId === id));
    const qualified = item.status === "unavailable" && unsupported && Array.isArray(ids) && ids.length === 0;
    let assessment;
    if (textPresent && (supported || qualified) && typeof assessAnswerFacet === "function") {
      assessment = runSkillPolicy(assessAnswerFacet, {
          facet, text: item.text, status: item.status,
          evidence: ids.map((id) => structuredClone(input.evidenceLedger.get(id))),
          claimEvidenceUses: uses.filter((use) => ids.includes(use.evidenceId)),
          reasonCode: progress.unsupportedFacets.find(({ facetId }) => facetId === item.facetId)?.reasonCode
            ?? (facet.requirement === "optional" && uses.length === 0 ? "optional_not_covered" : null)
      });
    }
    if (assessment?.valid !== true) {
      errors.push(`answer_facet_not_validated:${item.facetId}`);
      missing.add(item.facetId);
    } else {
      missing.delete(item.facetId);
    }
  }
  for (const facetId of progress.requiredFacets) {
    if (!seen.has(facetId)) {
      errors.push(`answer_facet_missing:${facetId}`);
      missing.add(facetId);
    }
  }
  const valid = errors.length === 0;
  return validateSkillCompletionResult({
    schemaVersion: SKILL_COMPLETION_SCHEMA_VERSION,
    valid,
    status: valid ? projected.status : "rejected",
    errors: [...new Set(errors)],
    missingFacets: [...missing],
    reasonCodes: valid ? projected.reasonCodes : ["skill_completion_rejected"]
  });
}
