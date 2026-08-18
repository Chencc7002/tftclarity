import { validateSkillDefinition } from "./contracts.js";

export const KNOWN_SKILL_DATA_DEPENDENCIES = Object.freeze([
  "official_tft_entity_catalog",
  "current_unit_build_statistics",
  "current_composition_statistics",
  "current_composition_tactical_details",
  "mechanism_knowledge_index"
]);

function toolFeatures(tool) {
  return new Set((tool?.capabilities ?? []).flatMap((capability) => capability.features ?? []));
}

export class SkillRegistry {
  constructor({ definitions = [], toolRegistry, knownDataDependencies = KNOWN_SKILL_DATA_DEPENDENCIES } = {}) {
    if (!toolRegistry || typeof toolRegistry.get !== "function") throw new TypeError("SkillRegistry requires ToolRegistry");
    this.definitions = new Map();
    this.toolRegistry = toolRegistry;
    this.knownDataDependencies = new Set(knownDataDependencies);
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const value = validateSkillDefinition(definition);
    if (this.definitions.has(value.id)) throw new TypeError(`Skill is already registered: ${value.id}`);
    for (const { id } of value.dataDependencies) {
      if (!this.knownDataDependencies.has(id)) throw new TypeError(`Unknown Skill data dependency: ${id}`);
    }
    const allowedDefinitions = value.allowedTools.map((name) => {
      const tool = this.toolRegistry.get(name);
      if (!tool) throw new TypeError(`Skill allowed tool is not registered: ${name}`);
      return tool;
    });
    const provided = new Set(allowedDefinitions.flatMap((tool) => [...toolFeatures(tool)]));
    for (const capability of value.requiredCapabilities) {
      if (!provided.has(capability)) throw new TypeError(`Required Skill capability is not provided by an allowed tool: ${capability}`);
    }
    this.definitions.set(value.id, value);
    return this;
  }

  get(id) {
    return this.definitions.get(String(id)) ?? null;
  }

  list() {
    return [...this.definitions.values()];
  }
}

