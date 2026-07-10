import { normalizeAlias } from "./normalizer.js";
import { retrieveEntityCandidates } from "../llm/entity-candidate-retriever.js";

export const DEFAULT_HIGH_CONFIDENCE_FUZZY_OPTIONS = Object.freeze({
  confidenceThreshold: 0.9,
  minConfidenceMargin: 0.08,
  minInputFragmentLength: 8,
  minCatalogAliasConfidence: 0.8,
  candidateLimit: 5
});

function recordForCandidate(catalog, candidate) {
  if (candidate.entityType === "unit") {
    return catalog.unitByApiName?.get(candidate.apiName) ?? null;
  }
  if (candidate.entityType === "item") {
    return catalog.itemByApiName?.get(candidate.apiName) ?? null;
  }
  if (candidate.entityType === "trait") {
    return catalog.traitByFilterId?.get(candidate.apiName) ?? null;
  }
  return null;
}

function exactTargets(entities, entityType) {
  const matches = entityType === "unit"
    ? entities.units
    : entityType === "item"
      ? entities.items
      : entities.traits;
  return new Set((matches ?? []).map((match) => match.target));
}

function candidateRequests(input, entities, unresolvedEntityHints) {
  const requests = [];
  if ((entities.units ?? []).length === 0) {
    requests.push({
      entityType: "unit",
      inputFragment: String(input ?? "")
    });
  }
  for (const hint of unresolvedEntityHints ?? []) {
    requests.push({
      entityType: hint.entityType,
      inputFragment: hint.inputFragment
    });
  }
  return requests;
}

function isSafeInputFragment(value, minLength) {
  const normalized = normalizeAlias(value);
  return normalized.length >= minLength && /^[a-z0-9]+$/.test(normalized);
}

function selectUniqueCandidate(candidates, options) {
  const top = candidates[0];
  if (!top || top.matchType !== "fuzzy") return null;
  if (top.confidence < options.confidenceThreshold) return null;
  if (!isSafeInputFragment(top.inputFragment, options.minInputFragmentLength)) return null;

  const runnerUp = candidates.find((candidate) => candidate.apiName !== top.apiName);
  if (runnerUp && top.confidence - runnerUp.confidence < options.minConfidenceMargin) {
    return null;
  }
  return top;
}

export function resolveHighConfidenceEntityCandidates(input, options = {}) {
  if (options.enabled === false) return [];

  const catalog = options.catalog;
  const entities = options.entities ?? { units: [], items: [], traits: [], ambiguities: [] };
  if (!catalog || (entities.ambiguities ?? []).length > 0) return [];

  const config = {
    ...DEFAULT_HIGH_CONFIDENCE_FUZZY_OPTIONS,
    ...(options.config ?? {})
  };
  const retriever = options.retriever ?? retrieveEntityCandidates;
  const resolutions = [];

  for (const request of candidateRequests(input, entities, options.unresolvedEntityHints)) {
    const candidates = retriever(request.inputFragment, {
      catalog,
      entityTypes: [request.entityType],
      limit: config.candidateLimit
    });
    const candidate = selectUniqueCandidate(candidates, config);
    if (!candidate) continue;
    if (exactTargets(entities, request.entityType).has(candidate.apiName)) continue;

    const record = recordForCandidate(catalog, candidate);
    if (!record || record.current === false) continue;
    const aliasConfidence = Number(record.aliasConfidence);
    if (Number.isFinite(aliasConfidence) && aliasConfidence < config.minCatalogAliasConfidence) continue;

    resolutions.push({
      ...candidate,
      record,
      source: "local_high_confidence_fuzzy",
      matchType: "high_confidence_fuzzy"
    });
  }

  const unique = new Map();
  for (const resolution of resolutions) {
    const key = `${resolution.entityType}:${resolution.apiName}`;
    const existing = unique.get(key);
    if (!existing || resolution.confidence > existing.confidence) {
      unique.set(key, resolution);
    }
  }
  return [...unique.values()];
}
