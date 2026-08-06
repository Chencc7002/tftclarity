import { sha256, stableStringify } from "./mechanic-atom-extractor.js";

export const FACTOR_CANDIDATE_SCHEMA_VERSION = "factor_candidate.v1";
export const FACTOR_DISCOVERY_PACK_SCHEMA_VERSION = "factor_discovery_pack.v1";
export const FACTOR_SCHEMA_VERSION = "mechanism-factor-schema.v1";

const SPLIT_RATIOS = Object.freeze({
  discovery: 0.7,
  adjustment: 0.15,
  blind: 0.15
});

const RELATION_TYPES = new Set([
  "complementary",
  "redundant",
  "diminishing_returns",
  "trigger_dependency",
  "threshold",
  "multiplicative_hypothesis",
  "conditional_conflict",
  "no_sufficient_evidence",
  "other"
]);

const CLAIM_TYPES = new Set([
  "official_fact",
  "statistical_observation",
  "mechanism_inference"
]);

const FORMULA_STATUSES = new Set([
  "not_applicable",
  "qualitative_only",
  "hypothesis"
]);

function unique(values) {
  return [...new Set(values)];
}

function itemMultiset(items) {
  return [...items].sort().join("|");
}

function deterministicRank(value, seed) {
  return sha256(`${seed}:${value}`);
}

function splitCounts(total) {
  const entries = Object.entries(SPLIT_RATIOS).map(([name, ratio], index) => {
    const exact = total * ratio;
    return { name, count: Math.floor(exact), remainder: exact - Math.floor(exact), index };
  });
  let remaining = total - entries.reduce((sum, entry) => sum + entry.count, 0);
  entries
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((entry) => {
      if (remaining <= 0) return;
      entry.count += 1;
      remaining -= 1;
    });
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.count]));
}

export function assignUnitsToDiscoverySplits(cases, options = {}) {
  const seed = String(options.seed ?? "s17-factor-discovery-v1");
  const units = new Map();
  for (const caseRecord of cases ?? []) {
    if (caseRecord?.unit?.entityType && caseRecord.unit.entityType !== "playable_candidate") continue;
    const apiName = caseRecord?.unit?.apiName;
    if (!apiName) continue;
    if (!units.has(apiName)) {
      units.set(apiName, {
        apiName,
        name: caseRecord.unit.name ?? null,
        role: caseRecord.unit.role ?? null
      });
    }
  }
  const ordered = [...units.values()].sort((a, b) => {
    const rank = deterministicRank(a.apiName, seed).localeCompare(deterministicRank(b.apiName, seed));
    return rank || a.apiName.localeCompare(b.apiName);
  });
  const counts = splitCounts(ordered.length);
  const assignments = [];
  let cursor = 0;
  for (const split of ["discovery", "adjustment", "blind"]) {
    const end = cursor + counts[split];
    for (const unit of ordered.slice(cursor, end)) assignments.push({ ...unit, split });
    cursor = end;
  }
  assignments.sort((a, b) => a.apiName.localeCompare(b.apiName));
  return {
    schemaVersion: "mechanism_discovery_split.v1",
    seed,
    ratios: SPLIT_RATIOS,
    counts,
    assignments,
    hash: sha256(stableStringify(assignments))
  };
}

function comparisonCaseIds(comparison) {
  return [comparison?.from?.caseId, comparison?.to?.caseId].filter(Boolean);
}

function chooseOne(rows, selected, compare) {
  return [...rows].sort(compare).find((entry) => !selected.has(entry.caseId)) ?? null;
}

function medianCandidate(rows, selected) {
  const sorted = [...rows]
    .filter((entry) => !selected.has(entry.caseId))
    .sort((a, b) => a.stats.avgPlacement - b.stats.avgPlacement || b.stats.games - a.stats.games);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function selectStratifiedDiscoveryCases(cases, comparisons, splitManifest, options = {}) {
  const split = String(options.split ?? "discovery");
  const limit = Math.max(1, Number(options.limit ?? 300));
  const assignment = new Map(
    splitManifest.assignments.map((entry) => [entry.apiName, entry.split])
  );
  const eligible = (cases ?? []).filter((entry) => (
    assignment.get(entry?.unit?.apiName) === split
    && entry?.unit?.entityType !== "auxiliary"
    && entry?.evidencePolicy?.officialTextComplete !== false
  ));
  const byUnit = new Map();
  for (const entry of eligible) {
    const unit = entry.unit.apiName;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(entry);
  }

  const comparisonScoreByCase = new Map();
  for (const comparison of comparisons ?? []) {
    if (assignment.get(comparison?.unit?.apiName) !== split) continue;
    const score = Number(comparison?.sampleEvidence?.minimumGames ?? 0);
    for (const caseId of comparisonCaseIds(comparison)) {
      comparisonScoreByCase.set(caseId, Math.max(score, comparisonScoreByCase.get(caseId) ?? 0));
    }
  }

  const selected = new Map();
  const strata = new Map();
  const add = (entry, stratum) => {
    if (!entry || selected.has(entry.caseId) || selected.size >= limit) return;
    selected.set(entry.caseId, entry);
    strata.set(entry.caseId, stratum);
  };
  const units = [...byUnit.keys()].sort();
  const selectors = [
    ["single_slot_contrast", (rows, chosen) => chooseOne(rows.filter((row) => comparisonScoreByCase.has(row.caseId)), chosen,
      (a, b) => (comparisonScoreByCase.get(b.caseId) ?? 0) - (comparisonScoreByCase.get(a.caseId) ?? 0)
        || b.stats.games - a.stats.games)],
    ["highest_sample", (rows, chosen) => chooseOne(rows, chosen, (a, b) => b.stats.games - a.stats.games)],
    ["strong_best_observed", (rows, chosen) => chooseOne(rows.filter((row) => row.stats.games >= 400), chosen,
      (a, b) => a.stats.avgPlacement - b.stats.avgPlacement || b.stats.games - a.stats.games)],
    ["strong_worst_observed", (rows, chosen) => chooseOne(rows.filter((row) => row.stats.games >= 400), chosen,
      (a, b) => b.stats.avgPlacement - a.stats.avgPlacement || b.stats.games - a.stats.games)],
    ["low_sample_mechanism", (rows, chosen) => chooseOne(rows.filter((row) => row.stats.games < 400), chosen,
      (a, b) => b.stats.games - a.stats.games)],
    ["median_observed", medianCandidate]
  ];

  for (const [stratum, selector] of selectors) {
    for (const unit of units) add(selector(byUnit.get(unit), selected), stratum);
  }

  let round = 0;
  while (selected.size < limit) {
    let added = 0;
    for (const unit of units) {
      const candidate = chooseOne(byUnit.get(unit), selected, (a, b) => {
        const diversityA = unique(a.rawItems ?? []).length;
        const diversityB = unique(b.rawItems ?? []).length;
        return diversityB - diversityA
          || deterministicRank(a.caseId, `${splitManifest.seed}:fill:${round}`)
            .localeCompare(deterministicRank(b.caseId, `${splitManifest.seed}:fill:${round}`));
      });
      if (candidate) {
        add(candidate, "diversity_fill");
        added += 1;
      }
      if (selected.size >= limit) break;
    }
    if (!added) break;
    round += 1;
  }

  const records = [...selected.values()];
  return {
    cases: records,
    manifest: {
      schemaVersion: "mechanism_discovery_sample.v1",
      split,
      requestedLimit: limit,
      selectedCount: records.length,
      unitCount: unique(records.map((entry) => entry.unit.apiName)).length,
      splitManifestHash: splitManifest.hash,
      cases: records.map((entry) => ({
        caseId: entry.caseId,
        unitApiName: entry.unit.apiName,
        itemMultiset: itemMultiset(entry.rawItems ?? []),
        games: entry.stats.games,
        avgPlacement: entry.stats.avgPlacement,
        sampleTier: entry.stats.sampleEvidence?.tier ?? null,
        stratum: strata.get(entry.caseId)
      })),
      hash: sha256(stableStringify(records.map((entry) => entry.caseId)))
    }
  };
}

function compactItem(item) {
  return {
    apiName: item.apiName,
    name: item.name,
    effect: item.effect,
    mechanicAtoms: item.mechanicAtoms,
    sourceHash: item.sourceHash,
    sourceUrl: item.sourceUrl,
    sourceQuality: item.sourceQuality
  };
}

function compactComparison(comparison, caseById) {
  const fromCase = caseById.get(comparison.from.caseId);
  const toCase = caseById.get(comparison.to.caseId);
  const itemByApiName = new Map(
    [...(fromCase?.items ?? []), ...(toCase?.items ?? [])].map((item) => [item.apiName, item])
  );
  const removed = itemByApiName.get(comparison.from.removedItem);
  const added = itemByApiName.get(comparison.to.addedItem);
  const compactChangedItem = (item, apiName) => item ? {
    apiName: item.apiName,
    name: item.name,
    effect: item.effect,
    sourceHash: item.sourceHash,
    sourceUrl: item.sourceUrl,
    sourceQuality: item.sourceQuality
  } : { apiName };
  return {
    comparisonId: comparison.comparisonId,
    sharedItems: comparison.sharedItems,
    from: comparison.from,
    to: comparison.to,
    deltas: comparison.deltas,
    sampleEvidence: comparison.sampleEvidence,
    evidencePolicy: comparison.evidencePolicy,
    changedItemFacts: {
      removed: compactChangedItem(removed, comparison.from.removedItem),
      added: compactChangedItem(added, comparison.to.addedItem)
    }
  };
}

export function buildFactorDiscoveryPack(caseRecord, comparisons = [], options = {}) {
  const allCases = options.allCases ?? [caseRecord];
  const caseById = new Map(allCases.map((entry) => [entry.caseId, entry]));
  const relevant = comparisons
    .filter((entry) => comparisonCaseIds(entry).includes(caseRecord.caseId))
    .slice(0, Number(options.maxComparisons ?? 3))
    .map((entry) => compactComparison(entry, caseById));
  return {
    schemaVersion: FACTOR_DISCOVERY_PACK_SCHEMA_VERSION,
    caseId: caseRecord.caseId,
    season: caseRecord.season,
    patch: caseRecord.patch,
    unit: {
      apiName: caseRecord.unit.apiName,
      name: caseRecord.unit.name,
      role: caseRecord.unit.role,
      stats: caseRecord.unit.stats,
      ability: caseRecord.unit.ability,
      mechanicAtoms: caseRecord.unit.mechanicAtoms,
      sourceHash: caseRecord.unit.sourceHash,
      sourceUrl: caseRecord.unit.sourceUrl,
      sourceQuality: caseRecord.unit.sourceQuality
    },
    items: caseRecord.items.map(compactItem),
    stats: caseRecord.stats,
    evidencePolicy: caseRecord.evidencePolicy,
    comparisons: relevant
  };
}

function isConfidence(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
}

function allowedSourceRef(ref, pack) {
  const unitAtomMatch = ref.match(/^unit\.mechanicAtoms\[(\d+)\]$/u);
  if (unitAtomMatch) return Number(unitAtomMatch[1]) < (pack.unit.mechanicAtoms?.length ?? 0);
  if (/^unit\.(?:role|stats\.[A-Za-z0-9_]+|ability\.(?:name|type|description))$/u.test(ref)) {
    return true;
  }
  const itemMatch = ref.match(/^items\[(\d+)\]\.(?:effect|mechanicAtoms\[\d+\])$/u);
  if (itemMatch) {
    const itemIndex = Number(itemMatch[1]);
    if (itemIndex >= pack.items.length) return false;
    const atomMatch = ref.match(/\.mechanicAtoms\[(\d+)\]$/u);
    return !atomMatch || Number(atomMatch[1]) < (pack.items[itemIndex].mechanicAtoms?.length ?? 0);
  }
  const comparisonMatch = ref.match(/^comparisons\[(\d+)\]\.(?:from|to|deltas|sampleEvidence|changedItemFacts)(?:\.[A-Za-z0-9_]+)*$/u);
  if (comparisonMatch) return Number(comparisonMatch[1]) < pack.comparisons.length;
  return false;
}

function validateObservationList(errors, value, path, pack, options = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path}:must_be_array`);
    return;
  }
  value.forEach((entry, index) => {
    const current = `${path}[${index}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${current}:must_be_object`);
      return;
    }
    if (!String(entry.label ?? "").trim()) errors.push(`${current}.label:required`);
    if (!String(entry.description ?? "").trim()) errors.push(`${current}.description:required`);
    if (!CLAIM_TYPES.has(entry.claimType)) errors.push(`${current}.claimType:invalid`);
    if (!isConfidence(entry.confidence)) errors.push(`${current}.confidence:invalid`);
    if (!Array.isArray(entry.sourceRefs) || entry.sourceRefs.length === 0) {
      errors.push(`${current}.sourceRefs:required`);
    } else {
      for (const ref of entry.sourceRefs) {
        if (!allowedSourceRef(String(ref), pack)) errors.push(`${current}.sourceRefs:invalid:${ref}`);
      }
    }
    if (options.item && !pack.items.some((item) => item.apiName === entry.itemApiName)) {
      errors.push(`${current}.itemApiName:not_in_case`);
    }
  });
}

function hasFixedBuildClaim(value) {
  const text = JSON.stringify(value);
  return /(?:必须|必出|必备|只能出|一定要).{0,12}(?:装备|件|装)/u.test(text);
}

export function validateFactorCandidate(candidate, pack) {
  const errors = [];
  if (candidate?.schemaVersion !== FACTOR_CANDIDATE_SCHEMA_VERSION) errors.push("schemaVersion:invalid");
  if (candidate?.caseId !== pack?.caseId) errors.push("caseId:mismatch");
  validateObservationList(errors, candidate?.unitObservations, "unitObservations", pack);
  validateObservationList(errors, candidate?.itemObservations, "itemObservations", pack, { item: true });
  validateObservationList(errors, candidate?.unknownFactors, "unknownFactors", pack);
  validateObservationList(errors, candidate?.statisticalObservations, "statisticalObservations", pack);

  if (!Array.isArray(candidate?.relationshipCandidates)) {
    errors.push("relationshipCandidates:must_be_array");
  } else {
    validateObservationList(errors, candidate.relationshipCandidates, "relationshipCandidates", pack);
    candidate.relationshipCandidates.forEach((entry, index) => {
      const path = `relationshipCandidates[${index}]`;
      if (!RELATION_TYPES.has(entry.relationType)) errors.push(`${path}.relationType:invalid`);
      if (!FORMULA_STATUSES.has(entry.formulaStatus)) errors.push(`${path}.formulaStatus:invalid`);
      if (entry.causal !== false) errors.push(`${path}.causal:must_be_false`);
      if (!Array.isArray(entry.conditions)) errors.push(`${path}.conditions:must_be_array`);
      if (!Array.isArray(entry.failureConditions)) errors.push(`${path}.failureConditions:must_be_array`);
      if (entry.relationType === "multiplicative_hypothesis" && entry.formulaStatus !== "hypothesis") {
        errors.push(`${path}.formulaStatus:multiplicative_must_be_hypothesis`);
      }
    });
  }
  if (hasFixedBuildClaim(candidate)) errors.push("contains_fixed_build_answer");
  return errors;
}

export function normalizeFactorCandidate(candidate, options = {}) {
  const normalized = structuredClone(candidate);
  if (options.caseId) normalized.caseId = options.caseId;
  for (const relationship of normalized?.relationshipCandidates ?? []) {
    if (["no_sufficient_evidence", "unverified", "unknown", "not_verified"].includes(relationship.formulaStatus)) {
      relationship.formulaStatus = "qualitative_only";
    }
    if (relationship.relationType === "multiplicative_hypothesis") {
      relationship.formulaStatus = "hypothesis";
    }
  }
  return normalized;
}
