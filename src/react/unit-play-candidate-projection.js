import { createHash } from "node:crypto";

import {
  UNIT_PLAY_CANDIDATE_RENDERED_CONTEXT_SHA256,
  UNIT_PLAY_CANDIDATE_SKILL_SHA256
} from "../skills/unit-play-control.js";

const pick = (value, keys) => Object.fromEntries(keys.flatMap((key) => (
  value?.[key] === undefined ? [] : [[key, value[key]]]
)));

const compactSource = (source) => pick(source, [
  "provider", "sourceType", "sourceId", "endpoint", "detailsEndpoint",
  "definitionEndpoint", "updatedAt", "risk", "retrieval"
]);

function projectToolValue(tool, value, targetUnitId) {
  if (!value || typeof value !== "object") return value;
  if (tool === "entity_catalog_query") return {
    ...pick(value, ["type", "source", "updatedAt", "entityType", "requestedNames", "resolution", "scope"]),
    results: (value.results ?? []).map((entry) => pick(entry, ["apiName", "displayName", "name", "entityType"]))
  };
  if (["unit_details", "item_details"].includes(tool)) return {
    ...pick(value, ["schemaVersion", "type", "status", "entityType", "apiName", "displayName", "entityRef", "scope", "facts", "updatedAt", "warnings"]),
    source: compactSource(value.source)
  };
  if (tool === "item_details_batch") return {
    ...pick(value, ["schemaVersion", "type", "status", "scope", "selection", "mechanismStatus", "updatedAt", "warnings"]),
    items: (value.items ?? []).map((item) => ({
      ...pick(item, ["schemaVersion", "type", "status", "entityType", "apiName", "displayName", "entityRef", "scope", "facts", "updatedAt", "warnings", "claimId", "evidencePath"]),
      source: compactSource(item.source)
    }))
  };
  if (tool === "unit_builds") return {
    ...pick(value, ["type", "updatedAt", "warnings", "mechanismQueryPlan"]),
    unit: pick(value.unit, ["apiName", "name"]),
    cards: (value.cards ?? []).slice(0, 1).map((card) => ({
      ...pick(card, ["title", "winner", "stats", "lowSample"]),
      items: (card.items ?? []).map((item) => pick(item, ["apiName", "name", "locked"]))
    })),
    query: pick(value.query, ["unit", "unitName", "starLevel", "itemCount", "itemPolicy", "patch", "days", "rankFilter", "minSamples"]),
    source: compactSource(value.source),
    scope: value.scope
  };
  if (tool === "comps_rankings") return {
    ...pick(value, ["schemaVersion", "type", "resolution", "updatedAt", "warnings", "query"]),
    results: (value.results ?? []).map((row) => ({
      compositionRef: row.compositionRef,
      members: (row.members ?? []).map((member) => pick(member, ["apiName", "name", "relations", "roleEvidence"])),
      traits: (Array.isArray(row.traits) ? row.traits : []).map((trait) => pick(trait, ["apiName", "name", "count", "style", "minUnits"])),
      stats: pick(row.stats, ["games", "top4Rate", "winRate", "avgPlacement"]),
      source: compactSource(row.source),
      tacticalDetailQueryPlan: row.tacticalDetailQueryPlan
    })),
    source: compactSource(value.source)
  };
  if (tool === "composition_tactical_details") return {
    ...pick(value, ["type", "ok", "compId", "clusterId", "seasonContextId", "compositionRef", "warnings"]),
    formation: {
      ...pick(value.formation, ["status", "missingUnitApiNames", "reasons", "source"]),
      units: (value.formation?.units ?? []).filter((unit) => unit.apiName === targetUnitId).map((unit) => ({
        ...pick(unit, ["apiName", "name", "boardPosition", "combatProfile"])
      }))
    },
    source: compactSource(value.source)
  };
  return value;
}

function projectEvidence(entry, targetUnitId) {
  if (!entry || typeof entry !== "object") return entry;
  return {
    ...pick(entry, ["evidenceId", "toolCallId", "toolName", "type", "source", "updatedAt", "metadata", "fingerprint", "validatedAt"]),
    value: projectToolValue(entry.toolName, entry.value, targetUnitId)
  };
}

export function projectUnitPlayCandidateObservation(observation, targetUnitId) {
  if (observation?.type !== "tool_result") return structuredClone(observation);
  return {
    ...structuredClone(observation),
    value: projectToolValue(observation.tool, observation.value, targetUnitId),
    evidence: projectEvidence(observation.evidence, targetUnitId)
  };
}

function projectUserMessage(message, targetUnitId) {
  if (message.role !== "user") return message;
  let payload;
  try { payload = JSON.parse(message.content); } catch { return message; }
  if (payload?.schemaVersion === "react-transcript-event.v1" && payload.type === "observation") {
    payload.value = projectUnitPlayCandidateObservation(payload.value, targetUnitId);
  } else if (payload?.state && payload?.toolCatalog) {
    payload.state.observations = (payload.state.observations ?? [])
      .map((entry) => projectUnitPlayCandidateObservation(entry, targetUnitId));
  }
  return { ...message, content: JSON.stringify(payload) };
}

function actionShape(message) {
  if (message.role !== "assistant") return message;
  let event;
  try { event = JSON.parse(message.content); } catch { return message; }
  if (event?.schemaVersion !== "react-transcript-event.v1" || event.type !== "decision"
    || event.value?.schemaVersion !== "react-action.v1") return message;
  return { ...message, content: JSON.stringify(event.value) };
}

export function validateUnitPlayCandidateDecisionProfile(profile) {
  if (profile == null) return null;
  const keys = Object.keys(profile).sort();
  const expected = ["decisionMessages", "guidance", "observationProjection", "schemaVersion", "tacticalPresentationScope"].sort();
  const projectionKeys = Object.keys(profile.observationProjection ?? {}).sort();
  const expectedProjectionKeys = ["schemaVersion", "targetUnitId"].sort();
  let guidance;
  try { guidance = JSON.parse(profile.guidance); } catch { guidance = null; }
  if (JSON.stringify(keys) !== JSON.stringify(expected)
    || JSON.stringify(projectionKeys) !== JSON.stringify(expectedProjectionKeys)
    || profile.schemaVersion !== "unit-play-candidate-decision-profile.v1"
    || typeof profile.guidance !== "string" || !profile.guidance
    || createHash("sha256").update(String(profile.guidance)).digest("hex")
      !== UNIT_PLAY_CANDIDATE_RENDERED_CONTEXT_SHA256
    || guidance?.schemaVersion !== "unit-play-browser-candidate.v1"
    || guidance?.contentHash !== UNIT_PLAY_CANDIDATE_SKILL_SHA256
    || guidance?.skillContext?.skillId !== "unit_play_guidance"
    || guidance?.skillContext?.skillVersion !== "1.5.11"
    || profile.decisionMessages !== "action"
    || profile.tacticalPresentationScope !== true
    || profile.observationProjection?.schemaVersion !== "unit-play-model-observation-projection.v1"
    || !String(profile.observationProjection?.targetUnitId ?? "").trim()) {
    throw new TypeError("Invalid unit-play candidate decision profile");
  }
  return profile;
}

export function validateUnitPlayCandidateDecisionRequest(request = {}) {
  const profile = validateUnitPlayCandidateDecisionProfile(request.candidateDecisionProfile);
  if (!profile) return null;
  const guidance = JSON.parse(profile.guidance);
  const expectedTools = [...guidance.skillContext.toolPolicy.effectiveTools].sort();
  const actualTools = (request.toolCatalog ?? []).map(({ name }) => String(name)).sort();
  const subjectId = String(request.state?.semanticAdvisory?.subject?.resolvedId ?? "");
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)
    || subjectId !== String(profile.observationProjection.targetUnitId)) {
    throw new TypeError("Unit-play candidate decision request does not match its frozen profile");
  }
  return profile;
}

export function applyUnitPlayCandidateDecisionProfile(messages, profile) {
  const value = validateUnitPlayCandidateDecisionProfile(profile);
  if (!value) return messages;
  const targetUnitId = String(value.observationProjection.targetUnitId);
  return messages.map((message) => actionShape(projectUserMessage(message, targetUnitId)));
}
