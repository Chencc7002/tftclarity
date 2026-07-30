import { calculatePlacementStats, parseBuildItems } from "../core/stats-calculator.js";
import {
  entityContentHash,
  extractStatAtoms,
  extractTextNumericAtoms,
  sha256,
  stableStringify
} from "./mechanic-atom-extractor.js";

export const MECHANISM_CASE_SCHEMA_VERSION = "mechanism_case.v1";
export const REPLACEMENT_COMPARISON_SCHEMA_VERSION = "item_replacement_comparison.v1";

export function classifySampleEvidence(games) {
  const sampleGames = Number(games) || 0;
  if (sampleGames < 100) {
    return {
      tier: "mechanism_only",
      lowSample: true,
      eligibleForPerformanceInference: false
    };
  }
  if (sampleGames < 400) {
    return {
      tier: "weak",
      lowSample: true,
      eligibleForPerformanceInference: false
    };
  }
  if (sampleGames < 1000) {
    return {
      tier: "general_comparison",
      lowSample: false,
      eligibleForPerformanceInference: true
    };
  }
  if (sampleGames < 3000) {
    return {
      tier: "strong",
      lowSample: false,
      eligibleForPerformanceInference: true
    };
  }
  return {
    tier: "high_coverage",
    lowSample: false,
    eligibleForPerformanceInference: true
  };
}

function unique(values) {
  return [...new Set(values)];
}

function normalizePlacementCount(value) {
  if (!Array.isArray(value) || value.length !== 8) return null;
  const counts = value.map(Number);
  return counts.every((count) => Number.isFinite(count) && count >= 0) ? counts : null;
}

function itemMultisetKey(items) {
  return [...items].sort().join("|");
}

function buildOfficialUnit(unit, sourceDocumentHash) {
  const sourceVersion = unit?.source?.version ?? null;
  const sourceHash = entityContentHash({
    apiName: unit.apiName,
    name: unit.name,
    role: unit.role,
    stats: unit.stats,
    ability: unit.ability
  });
  const sourceRef = `${unit.source?.url ?? "official:chess"}#${unit.apiName}`;
  return {
    apiName: unit.apiName,
    name: unit.name,
    role: unit.role,
    stats: unit.stats,
    ability: {
      name: unit.ability?.name ?? null,
      type: unit.ability?.type ?? null,
      description: unit.ability?.description ?? null
    },
    entityType: unit.entityType ?? "playable_candidate",
    mechanicAtoms: [
      ...extractStatAtoms(unit.stats, { sourceRef, sourceVersion, sourceHash }),
      ...extractTextNumericAtoms(unit.ability?.description, {
        sourceRef: `${sourceRef}.ability.description`,
        sourceVersion,
        sourceHash
      })
    ],
    sourceVersion,
    sourceHash,
    sourceDocumentHash,
    sourceUrl: unit.source?.url ?? null,
    sourceQuality: {
      unresolvedTokens: unit.ability?.unresolvedTokens ?? [],
      scalingReferences: unit.ability?.scalingReferences ?? [],
      textComplete: (unit.ability?.unresolvedTokens?.length ?? 0) === 0,
      numericFormulaComplete: unit.ability?.numericFormulaComplete ?? true
    }
  };
}

function buildOfficialItem(item, catalogMeta, sourceDocumentHash) {
  const sourceVersion = catalogMeta?.version ?? null;
  const sourceHash = entityContentHash({
    apiName: item.apiName,
    name: item.name,
    effect: item.effect,
    keywords: item.keywords,
    recipe: item.recipe,
    craftable: item.craftable
  });
  const sourceRef = `${item.sourceUrl ?? catalogMeta?.sourceUrl ?? "official:equip"}#${item.apiName}`;
  return {
    apiName: item.apiName,
    name: item.name,
    effect: item.effect,
    keywords: item.keywords ?? [],
    craftable: Boolean(item.craftable),
    mechanicAtoms: extractTextNumericAtoms(item.effect, {
      sourceRef: `${sourceRef}.effect`,
      sourceVersion,
      sourceHash
    }),
    sourceVersion,
    sourceHash,
    sourceDocumentHash,
    sourceUrl: item.sourceUrl ?? catalogMeta?.sourceUrl ?? null,
    sourceQuality: {
      unresolvedTokens: item.unresolvedTokens ?? [],
      textComplete: (item.unresolvedTokens?.length ?? 0) === 0,
      numericFormulaComplete: item.numericFormulaComplete ?? true
    }
  };
}

export function createQueryFingerprint(queryContext, source = {}) {
  return sha256(stableStringify({
    queryContext,
    provider: source.provider ?? null,
    endpoint: source.endpoint ?? null,
    providerQuery: source.providerQuery ?? null
  }));
}

export function createMechanismCase(input) {
  const row = input.row ?? {};
  const placementCount = normalizePlacementCount(row.placement_count ?? row.placementCount);
  if (!placementCount) {
    return { case: null, errors: ["placement_count_must_have_8_non_negative_values"] };
  }
  const rawItems = parseBuildItems(row);
  if (rawItems.length !== 3) {
    return { case: null, errors: [`expected_3_items_received_${rawItems.length}`] };
  }
  if (!input.unit) {
    return { case: null, errors: ["missing_official_unit"] };
  }
  const missingItems = unique(rawItems.filter((apiName) => !input.itemCatalog?.get?.(apiName)));
  if (missingItems.length) {
    return {
      case: null,
      errors: missingItems.map((apiName) => `missing_official_item:${apiName}`)
    };
  }

  const queryFingerprint = createQueryFingerprint(input.queryContext, input.source);
  const sortedItems = [...rawItems].sort();
  const officialUnit = buildOfficialUnit(input.unit, input.officialHashes?.chess ?? null);
  const officialItems = rawItems.map((apiName) => buildOfficialItem(
    input.itemCatalog.get(apiName),
    input.itemCatalog.meta,
    input.officialHashes?.equipment ?? null
  ));
  const calculatedStats = calculatePlacementStats(placementCount);
  const stats = {
    ...calculatedStats,
    sampleEvidence: classifySampleEvidence(calculatedStats.games)
  };
  const patch = String(input.patch ?? officialUnit.sourceVersion ?? "unknown");
  const caseId = [
    "set17",
    patch,
    input.unit.apiName,
    itemMultisetKey(sortedItems),
    `q-${queryFingerprint.slice(0, 12)}`
  ].join(":");

  return {
    case: {
      schemaVersion: MECHANISM_CASE_SCHEMA_VERSION,
      caseId,
      season: "S17",
      patch,
      queryContext: input.queryContext,
      unit: officialUnit,
      items: officialItems,
      rawItems,
      sortedItemMultiset: sortedItems,
      compContext: null,
      placementCount,
      stats,
      source: {
        provider: input.source?.provider ?? "MetaTFT",
        endpoint: input.source?.endpoint ?? null,
        capturedAt: input.source?.capturedAt ?? null,
        providerQuery: input.source?.providerQuery ?? null,
        requestFingerprint: queryFingerprint,
        responseHash: input.source?.responseHash ?? null,
        rawResponsePath: input.source?.rawResponsePath ?? null
      },
      evidencePolicy: {
        statisticsAreObservational: true,
        causalClaimAllowed: false,
        officialMechanicsTraceable: true,
        officialTextComplete: officialUnit.sourceQuality.textComplete
          && officialItems.every((item) => item.sourceQuality.textComplete),
        numericFormulaComplete: officialUnit.sourceQuality.numericFormulaComplete
          && officialItems.every((item) => item.sourceQuality.numericFormulaComplete)
      }
    },
    errors: []
  };
}

function removeAt(items, index) {
  return items.filter((_item, itemIndex) => itemIndex !== index).sort();
}

function replacementKey(caseRecord, index) {
  return [
    caseRecord.patch,
    caseRecord.unit.apiName,
    caseRecord.source.requestFingerprint,
    removeAt(caseRecord.rawItems, index).join("|")
  ].join(":");
}

function comparisonRecord(left, right, sharedItems, removedItem, addedItem) {
  const id = sha256(`${left.caseId}|${right.caseId}`).slice(0, 24);
  const minimumGames = Math.min(left.stats.games, right.stats.games);
  const sampleEvidence = classifySampleEvidence(minimumGames);
  return {
    schemaVersion: REPLACEMENT_COMPARISON_SCHEMA_VERSION,
    comparisonId: `set17:replacement:${id}`,
    season: "S17",
    patch: left.patch,
    unit: {
      apiName: left.unit.apiName,
      name: left.unit.name,
      sourceHash: left.unit.sourceHash,
      sourceUrl: left.unit.sourceUrl
    },
    sharedItems,
    from: {
      caseId: left.caseId,
      removedItem,
      games: left.stats.games,
      avgPlacement: left.stats.avgPlacement,
      top4Rate: left.stats.top4Rate,
      winRate: left.stats.winRate
    },
    to: {
      caseId: right.caseId,
      addedItem,
      games: right.stats.games,
      avgPlacement: right.stats.avgPlacement,
      top4Rate: right.stats.top4Rate,
      winRate: right.stats.winRate
    },
    deltas: {
      games: right.stats.games - left.stats.games,
      avgPlacement: right.stats.avgPlacement - left.stats.avgPlacement,
      top4Rate: right.stats.top4Rate - left.stats.top4Rate,
      winRate: right.stats.winRate - left.stats.winRate
    },
    queryFingerprint: left.source.requestFingerprint,
    sampleEvidence: {
      ...sampleEvidence,
      minimumGames
    },
    evidencePolicy: {
      relation: "observational_single_slot_comparison",
      causalClaimAllowed: false,
      eligibleForPerformanceInference: sampleEvidence.eligibleForPerformanceInference
    }
  };
}

export function createSingleItemReplacementComparisons(cases) {
  const buckets = new Map();
  for (const caseRecord of cases) {
    for (let index = 0; index < caseRecord.rawItems.length; index += 1) {
      const key = replacementKey(caseRecord, index);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({
        caseRecord,
        removed: caseRecord.rawItems[index],
        shared: removeAt(caseRecord.rawItems, index)
      });
    }
  }

  const comparisons = [];
  const seen = new Set();
  for (const candidates of buckets.values()) {
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        let left = candidates[leftIndex];
        let right = candidates[rightIndex];
        if (left.removed === right.removed) continue;
        if (right.caseRecord.caseId.localeCompare(left.caseRecord.caseId) < 0) {
          [left, right] = [right, left];
        }
        const pairKey = `${left.caseRecord.caseId}|${right.caseRecord.caseId}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        comparisons.push(comparisonRecord(
          left.caseRecord,
          right.caseRecord,
          left.shared,
          left.removed,
          right.removed
        ));
      }
    }
  }
  return comparisons.sort((a, b) => {
    const sampleA = Math.min(a.from.games, a.to.games);
    const sampleB = Math.min(b.from.games, b.to.games);
    if (sampleB !== sampleA) return sampleB - sampleA;
    return a.comparisonId.localeCompare(b.comparisonId);
  });
}

export function validateMechanismCase(caseRecord, options = {}) {
  const errors = [];
  if (caseRecord?.schemaVersion !== MECHANISM_CASE_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (!caseRecord?.caseId) errors.push("missing_case_id");
  if (!caseRecord?.unit?.sourceHash || !caseRecord?.unit?.sourceUrl) errors.push("unit_not_traceable");
  if (options.requireCompleteOfficialText && caseRecord?.unit?.sourceQuality?.unresolvedTokens?.length) {
    errors.push("unit_has_unresolved_official_tokens");
  }
  if (!Array.isArray(caseRecord?.items) || caseRecord.items.length !== 3) errors.push("invalid_item_count");
  caseRecord?.items?.forEach((item) => {
    if (!item.sourceHash || !item.sourceUrl) errors.push(`item_not_traceable:${item.apiName}`);
    if (options.requireCompleteOfficialText && item.sourceQuality?.unresolvedTokens?.length) {
      errors.push(`item_has_unresolved_official_tokens:${item.apiName}`);
    }
    item.mechanicAtoms?.forEach((atom) => {
      if (!atom.unit || !atom.condition || !atom.source?.hash) {
        errors.push(`invalid_item_atom:${item.apiName}`);
      }
    });
  });
  caseRecord?.unit?.mechanicAtoms?.forEach((atom) => {
    if (!atom.unit || !atom.condition || !atom.source?.hash) errors.push("invalid_unit_atom");
  });
  const recalculated = calculatePlacementStats(caseRecord?.placementCount);
  for (const key of ["games", "avgPlacement", "top4Rate", "winRate"]) {
    if (Math.abs(Number(recalculated[key]) - Number(caseRecord?.stats?.[key])) > 1e-12) {
      errors.push(`stats_mismatch:${key}`);
    }
  }
  if (!caseRecord?.stats?.sampleEvidence?.tier) errors.push("missing_sample_evidence");
  return errors;
}

export function selectStandardCases(cases, comparisons, limit = 300) {
  const byId = new Map(cases.map((entry) => [entry.caseId, entry]));
  const selected = new Map();
  const units = [...new Set(cases.map((entry) => entry.unit.apiName))].sort();

  for (const unit of units) {
    const pair = comparisons.find((entry) => entry.unit.apiName === unit);
    if (!pair) continue;
    for (const caseId of [pair.from.caseId, pair.to.caseId]) {
      if (selected.size < limit && byId.has(caseId)) selected.set(caseId, byId.get(caseId));
    }
  }

  const grouped = new Map(units.map((unit) => [unit, []]));
  for (const entry of cases) grouped.get(entry.unit.apiName)?.push(entry);
  const selectors = [
    (rows) => [...rows].sort((a, b) => b.stats.games - a.stats.games),
    (rows) => [...rows].filter((row) => row.stats.games >= 100).sort((a, b) => a.stats.avgPlacement - b.stats.avgPlacement),
    (rows) => [...rows].filter((row) => row.stats.games >= 100).sort((a, b) => b.stats.avgPlacement - a.stats.avgPlacement),
    (rows) => [...rows].filter((row) => row.stats.games < 400).sort((a, b) => b.stats.games - a.stats.games)
  ];

  for (const selector of selectors) {
    for (const unit of units) {
      const candidate = selector(grouped.get(unit) ?? []).find((entry) => !selected.has(entry.caseId));
      if (candidate) selected.set(candidate.caseId, candidate);
      if (selected.size >= limit) return [...selected.values()];
    }
  }

  for (const entry of [...cases].sort((a, b) => b.stats.games - a.stats.games)) {
    if (!selected.has(entry.caseId)) selected.set(entry.caseId, entry);
    if (selected.size >= limit) break;
  }
  return [...selected.values()];
}
