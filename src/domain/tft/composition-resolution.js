import { normalizeAlias } from "../../core/normalizer.js";

const GENERIC_COMPOSITION_WORDS = /(?:阵容|体系|玩法|组合|套路|comp(?:osition)?)/giu;

function compact(value) {
  return normalizeAlias(value).replace(GENERIC_COMPOSITION_WORDS, "");
}

function compactIdentity(value) {
  return compact(String(value ?? "").replace(/\s+路\s+/gu, " "));
}

function values(record, fallbacks = []) {
  return [...new Set([
    ...fallbacks,
    record?.zhName,
    record?.displayName,
    record?.name,
    ...(record?.aliases ?? [])
  ].map(compact).filter(Boolean))];
}

function unitRecord(catalog, apiName) {
  return catalog?.unitByApiName?.get?.(apiName) ?? null;
}

function traitRecord(catalog, trait = {}) {
  return catalog?.traitByFilterId?.get?.(trait.filterId)
    ?? catalog?.traitByApiName?.get?.(trait.apiName)
    ?? null;
}

function matchScore(comp, catalog, query) {
  const identity = [...new Set([compact(comp.compId), compactIdentity(comp.name)].filter(Boolean))];
  const memberAliases = (comp.units ?? []).flatMap((unit) => (
    values(unitRecord(catalog, unit.apiName), [unit.apiName, unit.name])
  ));
  const traitAliases = (comp.traits ?? []).flatMap((trait) => (
    values(traitRecord(catalog, trait), [trait.apiName, trait.filterId, trait.name])
  ));
  if (identity.includes(query)) return { score: 100, matchedBy: "composition_identity" };
  if (identity.some((alias) => alias.includes(query) || query.includes(alias))) {
    return { score: 90, matchedBy: "composition_identity_partial" };
  }
  if (memberAliases.includes(query)) return { score: 70, matchedBy: "member_alias" };
  if (traitAliases.includes(query)) return { score: 65, matchedBy: "trait_alias" };
  if (memberAliases.some((alias) => alias.includes(query) || query.includes(alias))) {
    return { score: 55, matchedBy: "member_alias_partial" };
  }
  if (traitAliases.some((alias) => alias.includes(query) || query.includes(alias))) {
    return { score: 50, matchedBy: "trait_alias_partial" };
  }
  return null;
}

function itemizedEvidence(coreBuilds, apiName) {
  return (coreBuilds ?? [])
    .filter((build) => build.unitApiName === apiName)
    .sort((left, right) => Number(right.games ?? 0) - Number(left.games ?? 0))[0] ?? null;
}

function serializeMember(unit, comp, catalog, details, memberIndex) {
  const build = itemizedEvidence(comp.coreBuilds, unit.apiName);
  const official = details?.units?.get?.(unit.apiName) ?? unitRecord(catalog, unit.apiName);
  return {
    apiName: unit.apiName,
    name: unit.name,
    targetStarLevel: unit.targetStarLevel ?? null,
    relations: ["member_of_comp", ...(build ? ["itemized_core_candidate"] : [])],
    roleEvidence: {
      memberOfComp: "supported",
      itemizedCoreCandidate: build ? "supported" : "not_observed",
      coreMember: "unknown",
      primaryCarry: "unknown",
      primaryTank: "unknown",
      flexSlot: "unknown"
    },
    officialProfile: {
      cost: official?.cost ?? null,
      role: official?.role ?? null,
      traits: [...(official?.traitNames ?? official?.traits ?? [])]
    },
    itemizationEvidence: build ? {
      games: Number(build.games ?? 0),
      averagePlacement: build.avgPlacement ?? null,
      items: [...(build.items ?? [])],
      evidencePath: `/members/${memberIndex}/itemizationEvidence`
    } : null
  };
}

function serializeComposition(comp, catalog, details) {
  const members = (comp.units ?? []).map((unit, index) => (
    serializeMember(unit, comp, catalog, details, index)
  ));
  const itemized = members.filter((member) => (
    member.relations.includes("itemized_core_candidate")
  )).sort((left, right) => (
    Number(right.itemizationEvidence?.games ?? 0) - Number(left.itemizationEvidence?.games ?? 0)
    || String(left.apiName).localeCompare(String(right.apiName))
  ));
  const selected = itemized.slice(0, 5);
  return {
    compositionRef: {
      compId: comp.compId,
      name: comp.name,
      patch: comp.patch ?? "current",
      clusterId: comp.source?.clusterId ?? null
    },
    members,
    itemContentionQueryPlan: {
      schemaVersion: "item-contention-query-plan.v1",
      status: selected.length >= 2 ? "ready" : "insufficient_candidates",
      compositionId: comp.compId,
      selectionBasis: "itemized_core_candidate_games_desc",
      entities: selected.map((member) => ({ apiName: member.apiName, name: member.name })),
      apiNames: selected.map((member) => member.apiName),
      optionsPerUnit: 3,
      totalCandidateCount: itemized.length,
      omittedCandidateCount: Math.max(0, itemized.length - selected.length)
    },
    traits: (comp.traits ?? []).map((trait) => ({
      apiName: trait.apiName,
      filterId: trait.filterId,
      name: trait.name,
      tier: trait.tier
    })),
    stats: structuredClone(comp.stats ?? {}),
    source: structuredClone(comp.source ?? null)
  };
}

export function resolveCompositionMention(rankings, options = {}) {
  const candidates = Array.isArray(rankings?.candidates) ? rankings.candidates : [];
  const requestedLimit = Number(options.limit ?? 5);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(5, Math.floor(requestedLimit)))
    : 5;
  const query = compact(options.mention);
  const scored = query
    ? candidates.map((comp) => ({ comp, ...matchScore(comp, options.catalog, query) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score
        || Number(right.comp.stats?.games ?? 0) - Number(left.comp.stats?.games ?? 0)
        || String(left.comp.compId).localeCompare(String(right.comp.compId)))
    : candidates.map((comp) => ({ comp, score: null, matchedBy: "unfiltered" }));
  const topScore = scored[0]?.score ?? null;
  const topMatches = topScore === null
    ? scored
    : scored.filter((entry) => entry.score === topScore);
  const status = !query
    ? "unfiltered"
    : !scored.length
      ? "not_found"
      : topMatches.length === 1
        ? "resolved"
        : "ambiguous";
  const selected = status === "resolved" ? scored.slice(0, 1) : scored.slice(0, limit);
  return {
    schemaVersion: "composition-resolution.v1",
    type: "composition_rankings",
    resolution: {
      mention: String(options.mention ?? ""),
      normalizedMention: query,
      status,
      matchedBy: status === "resolved" ? selected[0]?.matchedBy ?? null : null,
      candidateCount: scored.length
    },
    results: selected.map(({ comp }) => serializeComposition(
      comp,
      options.catalog,
      options.details
    )),
    source: structuredClone(rankings?.source ?? null),
    updatedAt: rankings?.source?.updatedAt ?? new Date().toISOString(),
    warnings: [
      ...(rankings?.warnings ?? []),
      ...(status === "not_found" ? ["composition_not_found"] : []),
      ...(status === "ambiguous" ? ["composition_ambiguous"] : [])
    ]
  };
}
