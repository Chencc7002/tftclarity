import { SKILL_PROGRESS_SCHEMA_VERSION, validateClaimEvidenceUse, validateSkillProgress, runSkillPolicy } from "./contracts.js";
import { SKILL_DEPENDENCY_TOOLS, validateSkillContextIdentity } from "./context.js";

// Server-side policy callbacks, never model-provided self-assessments.
// Without explicit scope/freshness/support approval an annotation covers nothing.
export function acceptedSkillEvidenceUses({ skill, context, evidenceLedger, claimEvidenceUses = [], assessEvidenceUse }) {
  validateSkillContextIdentity(skill, context);
  if (!Array.isArray(claimEvidenceUses)) throw new TypeError("Skill claim evidence uses must be an array");
  const result = new Map(skill.facets.map(({ id }) => [id, []]));
  for (const raw of claimEvidenceUses) {
    const use = validateClaimEvidenceUse(raw);
    if (use.supportsFacets.some((id) => !result.has(id))) throw new TypeError("Claim evidence use references unknown Skill facet");
    const entry = evidenceLedger?.get?.(use.evidenceId);
    if (!entry || !entry.validatedAt || !context.toolPolicy.effectiveTools.includes(entry.toolName)
      || use.role !== "supports" || typeof assessEvidenceUse !== "function") continue;
    // Current-task coverage cannot promote historical/stale Evidence, even when
    // a claim annotation or a policy callback tries to label it fresh.
    const temporal = [entry.temporalStatus, entry.metadata?.temporalStatus,
      entry.metadata?.freshnessStatus, entry.metadata?.freshness?.status, use.freshnessStatus];
    if (temporal.some((value) => ["historical", "stale", "expired"].includes(value))
      || entry.metadata?.stale === true || entry.value?.cache?.stale === true) continue;
    for (const facetId of use.supportsFacets) {
      const facet = skill.facets.find(({ id }) => id === facetId);
      const dependencies = facet.dataDependenciesAny ?? skill.dataDependencies.map(({ id }) => id);
      if (!dependencies.some((id) => SKILL_DEPENDENCY_TOOLS[id] === entry.toolName)) continue;
      const assessment = runSkillPolicy(assessEvidenceUse, { entry: structuredClone(entry), use, facet, context });
      if (assessment?.valid === true && assessment.scopeValid === true
        && assessment.freshnessValid === true && assessment.supportValid === true) {
        result.get(facetId).push(use);
      }
    }
  }
  return result;
}

export function evaluateSkillProgress(input) {
  const { skill, context } = input;
  // The old unvalidated facetEvidence shortcut must never imply coverage.
  if (Object.keys(input.facetEvidence ?? {}).length) throw new TypeError("Skill coverage requires ledger-backed claimEvidenceUses");
  const evidence = acceptedSkillEvidenceUses(input);
  const requiredFacets = skill.facets.filter(({ requirement }) => requirement !== "optional").map(({ id }) => id);
  const coveredFacets = [];
  const missingFacets = [];
  const unsupportedFacets = [];
  const availability = new Map(context.dataAvailability.map((entry) => [entry.dependencyId, entry]));
  for (const facetId of requiredFacets) {
    const facet = skill.facets.find(({ id }) => id === facetId);
    const uses = evidence.get(facetId);
    if (uses.length) {
      coveredFacets.push({
        facetId,
        evidenceIds: [...new Set(uses.map(({ evidenceId }) => evidenceId))].sort(),
        tierSummary: [...new Set(uses.map(({ tier }) => tier))].sort()
      });
      continue;
    }
    const dependencies = facet.dataDependenciesAny ?? skill.dataDependencies.map(({ id }) => id);
    // Unknown/stale sources remain recoverable; neither proves absence.
    const unavailable = dependencies.map((id) => availability.get(id));
    if (unavailable.length && unavailable.every((entry) => entry?.status === "unavailable")) {
      const reasons = [...new Set(unavailable.map(({ reasonCode }) => reasonCode))];
      unsupportedFacets.push({ facetId, reasonCode: reasons.length === 1 ? reasons[0] : "data_unavailable" });
    } else {
      missingFacets.push(facetId);
    }
  }
  const status = missingFacets.length ? "in_progress"
    : unsupportedFacets.length ? (skill.completionPolicy.allowQualifiedIncomplete ? "qualified_incomplete" : "in_progress")
      : "complete";
  const progress = validateSkillProgress({
    schemaVersion: SKILL_PROGRESS_SCHEMA_VERSION,
    skillId: skill.id,
    requiredFacets, coveredFacets, missingFacets, unsupportedFacets, status
  });
  return { progress, acceptedUses: evidence };
}

export function projectSkillProgress(input) {
  return evaluateSkillProgress(input).progress;
}
