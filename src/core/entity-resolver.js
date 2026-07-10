import { createCatalog } from "../data/static-data.js";
import { normalizeAlias } from "./normalizer.js";

function buildAliasCandidates(records, entityType, getTarget) {
  const candidates = [];
  for (const record of records) {
    const aliases = [record.zhName, record.shortName, record.displayName, ...(record.aliases ?? [])]
      .filter(Boolean);
    for (const alias of aliases) {
      candidates.push({
        entityType,
        alias,
        normalizedAlias: normalizeAlias(alias),
        record,
        target: getTarget(record)
      });
    }
  }
  return candidates.filter((candidate) => candidate.normalizedAlias.length > 0);
}

function candidateLabel(match) {
  if (match.entityType === "item") {
    return match.record.shortName
      ?? match.record.zhName
      ?? match.record.displayName
      ?? match.target;
  }
  if (match.entityType === "trait") {
    return match.record.displayName
      ?? match.record.zhName
      ?? match.record.apiName
      ?? match.target;
  }
  return match.record.zhName
    ?? match.record.displayName
    ?? match.target;
}

function ambiguityCandidate(match) {
  return {
    entityType: match.entityType,
    apiName: match.target,
    label: candidateLabel(match),
    matchedAlias: match.alias,
    inputFragment: match.normalizedAlias,
    confidence: 1,
    matchType: "exact_alias_ambiguity",
    source: "deterministic_entity_resolver"
  };
}

function ambiguityTargetKey(candidate) {
  if (candidate.entityType === "trait") {
    return `trait:${candidate.record.apiName ?? candidate.target}`;
  }
  return `${candidate.entityType}:${candidate.target}`;
}

function findMatches(input, candidates) {
  const normalizedInput = normalizeAlias(input);
  const rawMatches = [];

  for (const candidate of candidates) {
    const start = normalizedInput.indexOf(candidate.normalizedAlias);
    if (start >= 0) {
      rawMatches.push({
        ...candidate,
        start,
        end: start + candidate.normalizedAlias.length,
        confidence: 1
      });
    }
  }

  rawMatches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.normalizedAlias.length - a.normalizedAlias.length;
  });

  const matchesBySpan = new Map();
  for (const match of rawMatches) {
    const spanKey = `${match.start}:${match.end}`;
    if (!matchesBySpan.has(spanKey)) matchesBySpan.set(spanKey, []);
    matchesBySpan.get(spanKey).push(match);
  }

  const occupied = new Set();
  const accepted = [];
  const ambiguities = [];
  for (const match of rawMatches) {
    let overlaps = false;
    for (let index = match.start; index < match.end; index += 1) {
      if (occupied.has(index)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const spanKey = `${match.start}:${match.end}`;
    const sameSpan = matchesBySpan.get(spanKey) ?? [match];
    const candidatesByTarget = new Map();
    for (const candidate of sameSpan) {
      const targetKey = ambiguityTargetKey(candidate);
      if (!candidatesByTarget.has(targetKey)) {
        candidatesByTarget.set(targetKey, ambiguityCandidate(candidate));
      }
    }

    if (candidatesByTarget.size > 1) {
      for (let index = match.start; index < match.end; index += 1) {
        occupied.add(index);
      }
      ambiguities.push({
        inputFragment: match.normalizedAlias,
        start: match.start,
        end: match.end,
        candidates: [...candidatesByTarget.values()]
          .sort((left, right) => left.label.localeCompare(right.label))
      });
      continue;
    }

    for (let index = match.start; index < match.end; index += 1) {
      occupied.add(index);
    }
    accepted.push(match);
  }

  return {
    matches: accepted,
    ambiguities
  };
}

export function resolveEntities(input, options = {}) {
  const catalog = options.catalog ?? createCatalog();
  const candidates = [
    ...buildAliasCandidates(catalog.units, "unit", (unit) => unit.apiName),
    ...buildAliasCandidates(catalog.items, "item", (item) => item.apiName),
    ...buildAliasCandidates(catalog.traits, "trait", (trait) => trait.filterId)
  ];

  const { matches, ambiguities } = findMatches(input, candidates);

  return {
    units: matches.filter((match) => match.entityType === "unit"),
    items: matches.filter((match) => match.entityType === "item"),
    traits: matches.filter((match) => match.entityType === "trait"),
    all: matches,
    ambiguities
  };
}
