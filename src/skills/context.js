import { SKILL_CONTEXT_SCHEMA_VERSION, SKILL_DATA_AVAILABILITY_SCHEMA_VERSION, validateSkillContext, validateSkillDataAvailability, validateSkillDefinition } from "./contracts.js";

export const SKILL_DEPENDENCY_TOOLS = Object.freeze({
  official_tft_entity_catalog: "entity_catalog_query",
  official_unit_details: "unit_details",
  official_item_details: "item_details",
  official_item_details_batch: "item_details_batch",
  current_unit_build_statistics: "unit_builds",
  current_composition_statistics: "comps_rankings",
  current_composition_tactical_details: "composition_tactical_details",
  mechanism_knowledge_index: "semantic_search"
});

export function buildSkillContext({ skill, selection, taskFrame, runtimeAvailableTools = [], dataAvailability: observations = [] }) {
  validateSkillDefinition(skill);
  if (!Array.isArray(observations)) throw new TypeError("Skill availability observations must be an array");
  const observed = new Map();
  for (const raw of observations) {
    const entry = validateSkillDataAvailability(raw);
    if (!skill.dataDependencies.some(({ id }) => id === entry.dependencyId) || observed.has(entry.dependencyId)) throw new TypeError("Unknown or duplicate Skill availability dependency");
    if (!entry.sourceIds.length || entry.sourceIds.some((id) => id !== SKILL_DEPENDENCY_TOOLS[entry.dependencyId])) throw new TypeError("Skill availability source must match dependency tool");
    // A handler's existence is not an observation of usable data.
    if (entry.reasonCode === "available_registered_tool") throw new TypeError("Skill availability requires observed data");
    observed.set(entry.dependencyId, entry);
  }
  const available = [...new Set(runtimeAvailableTools.map(String))].sort();
  const effectiveTools = skill.allowedTools.filter((name) => available.includes(name)).sort();
  const dataAvailability = skill.dataDependencies.map(({ id }) => {
    const availableTool = SKILL_DEPENDENCY_TOOLS[id];
    const isAvailable = Boolean(availableTool && effectiveTools.includes(availableTool));
    if (isAvailable && observed.has(id)) return observed.get(id);
    return {
      schemaVersion: SKILL_DATA_AVAILABILITY_SCHEMA_VERSION,
      dependencyId: id,
      status: isAvailable ? "unknown" : "unavailable",
      reasonCode: isAvailable ? "not_probed" : "source_unavailable",
      observedAt: null,
      sourceIds: isAvailable ? [availableTool] : []
    };
  });
  return validateSkillContext({
    schemaVersion: SKILL_CONTEXT_SCHEMA_VERSION,
    skillId: skill.id,
    skillVersion: skill.version,
    selection: {
      skillId: selection.selected.skillId,
      skillVersion: selection.selected.skillVersion,
      score: selection.selected.score,
      reasons: [...selection.selected.reasons]
    },
    taskFrameSchemaVersion: taskFrame.schemaVersion,
    facets: structuredClone(skill.facets),
    evidencePolicy: structuredClone(skill.evidencePolicy),
    instructions: [...skill.instructions],
    dataAvailability,
    toolPolicy: {
      skillAllowedTools: [...skill.allowedTools],
      runtimeAvailableTools: available,
      effectiveTools
    },
    completionPolicy: structuredClone(skill.completionPolicy)
  });
}

export function validateSkillContextIdentity(skill, context) {
  validateSkillDefinition(skill);
  validateSkillContext(context);
  const dependencyIds = skill.dataDependencies.map(({ id }) => id).sort();
  if (context.skillId !== skill.id || context.skillVersion !== skill.version
    || JSON.stringify(context.facets) !== JSON.stringify(skill.facets)
    || JSON.stringify(context.instructions) !== JSON.stringify(skill.instructions)
    || JSON.stringify(context.evidencePolicy) !== JSON.stringify(skill.evidencePolicy)
    || JSON.stringify(context.completionPolicy) !== JSON.stringify(skill.completionPolicy)
    || JSON.stringify(context.dataAvailability.map(({ dependencyId }) => dependencyId).sort()) !== JSON.stringify(dependencyIds)
    || context.toolPolicy.effectiveTools.some((tool) => !skill.allowedTools.includes(tool))) {
    throw new TypeError("Skill context does not match definition");
  }
}
