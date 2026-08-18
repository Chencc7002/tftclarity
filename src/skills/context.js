import { SKILL_CONTEXT_SCHEMA_VERSION, SKILL_DATA_AVAILABILITY_SCHEMA_VERSION, validateSkillContext } from "./contracts.js";

const DEPENDENCY_TOOL = Object.freeze({
  official_tft_entity_catalog: "entity_catalog_query",
  current_unit_build_statistics: "unit_builds",
  current_composition_statistics: "comps_rankings",
  current_composition_tactical_details: "composition_tactical_details",
  mechanism_knowledge_index: "semantic_search"
});

export function buildSkillContext({ skill, selection, taskFrame, runtimeAvailableTools = [] }) {
  const available = [...new Set(runtimeAvailableTools.map(String))].sort();
  const effectiveTools = skill.allowedTools.filter((name) => available.includes(name)).sort();
  const dataAvailability = skill.dataDependencies.map(({ id }) => {
    const availableTool = DEPENDENCY_TOOL[id];
    const isAvailable = Boolean(availableTool && effectiveTools.includes(availableTool));
    return {
      schemaVersion: SKILL_DATA_AVAILABILITY_SCHEMA_VERSION,
      dependencyId: id,
      status: isAvailable ? "available" : "unavailable",
      reasonCode: isAvailable ? "available_registered_tool" : "source_unavailable",
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
