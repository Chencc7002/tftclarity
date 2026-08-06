import { normalizeAlias } from "../core/normalizer.js";
import { resolveGameConcept } from "./concept-resolver.js";
import {
  getConceptCapabilityDefinition
} from "../domain/tft/concept-capability-registry.js";

export const CONCEPT_CAPABILITY_MAP_VERSION = "concept-capability-map.v1";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function resolvedConceptId(entity) {
  if (entity?.expectedType !== "game_concept") return null;
  if (entity.resolvedId) return String(entity.resolvedId);
  return resolveGameConcept(entity.rawText).resolvedId;
}

export function resolveConceptCapability(taskFrame = {}) {
  const concepts = [
    ...array(taskFrame.subjects),
    ...array(taskFrame.candidates),
    ...array(taskFrame.concepts)
  ].filter((entity) => entity?.expectedType === "game_concept");
  const matches = concepts
    .map((entity) => ({
      entity,
      conceptId: resolvedConceptId(entity)
    }))
    .map((entry) => ({
      ...entry,
      definition: getConceptCapabilityDefinition(entry.conceptId)
    }))
    .filter((entry) => (
      entry.definition
      && entry.definition.supportedActions.includes(taskFrame.action)
    ));
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    schemaVersion: CONCEPT_CAPABILITY_MAP_VERSION,
    ...structuredClone(match.definition),
    mention: String(match.entity.rawText),
    normalizedMention: normalizeAlias(match.entity.rawText)
  };
}

export function getConceptCapability(conceptId) {
  return getConceptCapabilityDefinition(conceptId);
}
