import { normalizeCompsData, normalizeExplorerRows } from "./metatft-response-adapter.js";
import { createAssetResolver } from "./asset-resolver.js";
import { TRAITS, UNITS } from "./static-data.js";
import {
  traitAliasOverrideByApiName,
  traitAliasOverrideByFilterId,
  unitAliasOverrideByApiName
} from "./domain-alias-overrides.js";
import {
  traitDisplayOverrideByApiName,
  unitDisplayOverrideByApiName
} from "./entity-display-overrides.js";
import { canonicalUnitIdentity, preferEquivalentUnit } from "./unit-identity.js";

const seedUnitByApiName = new Map(UNITS.map((unit) => [unit.apiName, unit]));
const seedTraitByFilterId = new Map(TRAITS.map((trait) => [trait.filterId, trait]));
const seedTraitByApiName = new Map(TRAITS.map((trait) => [trait.apiName, trait]));
const unitMetadataResolver = createAssetResolver();
const UNIT_TOKEN_ALIASES = new Map([
  ["kayle", ["天使"]]
]);

function compact(values) {
  return [...new Set(values.filter(Boolean))];
}

function listFromApiValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(/[&,]\s*|\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function apiToken(apiName) {
  return String(apiName ?? "")
    .replace(/^DA_(?:18_)?/, "")
    .replace(/^TFT\d*_/, "")
    .replace(/_[0-9]+$/, "");
}

function unitLookupRecord(apiName, lookupByApiName) {
  const direct = lookupByApiName?.get?.(apiName);
  if (direct) return direct;
  for (const lookup of lookupByApiName?.values?.() ?? []) {
    const assetNames = Array.isArray(lookup?.assetNames) ? lookup.assetNames : [];
    if (assetNames.includes(apiName)) return lookup;
  }
  return null;
}

function traitApiNameFromFilterId(filterId) {
  return String(filterId ?? "").replace(/_[0-9]+$/, "");
}

function traitTierOverride(filterId, override) {
  const tier = String(filterId ?? "").match(/_(\d+)$/)?.[1];
  return tier ? override?.tiers?.[tier] ?? null : null;
}

function expandVerifiedTraitTiers(filterIds) {
  const expanded = new Set(filterIds);
  for (const filterId of filterIds) {
    const apiName = traitApiNameFromFilterId(filterId);
    const override = traitAliasOverrideByApiName.get(apiName);
    for (const tier of Object.keys(override?.tiers ?? {})) {
      expanded.add(`${apiName}_${tier}`);
    }
  }
  return [...expanded].sort();
}

function unitApiNameFromExplorerValue(value) {
  return String(value ?? "").replace(/-[0-9]+$/, "");
}

function sourceLabel(seed, override, dynamicSource) {
  return compact([
    seed ? "seed" : null,
    override ? "alias_override" : null,
    dynamicSource
  ]).join("+");
}

function unitRecord(apiName, options = {}, dynamicSource = null) {
  const seed = seedUnitByApiName.get(apiName);
  const override = unitAliasOverrideByApiName.get(apiName);
  const displayOverride = unitDisplayOverrideByApiName.get(apiName);
  const lookup = unitLookupRecord(apiName, options.unitLookupByApiName);
  const lookupName = String(lookup?.name ?? lookup?.displayName ?? "").trim() || null;
  const token = apiToken(apiName);
  const metadata = unitMetadataResolver.resolveUnit(apiName);
  const cost = Number(lookup?.cost ?? metadata.cost);
  const providerSampleCount = Number(options.providerSampleCount);
  return {
    apiName,
    canonicalApiName: lookup?.apiName ?? apiName,
    ...(Number.isFinite(providerSampleCount) && providerSampleCount > 0 ? { providerSampleCount } : {}),
    ...(Number.isFinite(cost) && cost > 0 ? { cost } : {}),
    zhName: displayOverride?.zhName ?? lookupName ?? override?.zhName ?? seed?.zhName ?? null,
    enName: displayOverride?.enName ?? null,
    aliases: compact([
      ...(displayOverride?.aliases ?? []),
      lookupName,
      override?.zhName,
      seed?.zhName,
      ...(override?.aliases ?? []),
      ...(seed?.aliases ?? []),
      ...(UNIT_TOKEN_ALIASES.get(token.toLowerCase()) ?? []),
      lookup?.apiName,
      ...(lookup?.assetNames ?? []),
      lookup?.en_name,
      apiName,
      token
    ]),
    fuzzyAliases: compact([
      ...(displayOverride?.fuzzyAliases ?? []),
      ...(override?.fuzzyAliases ?? []),
      ...(seed?.fuzzyAliases ?? [])
    ]),
    current: true,
    patch: options.patch ?? "current",
    source: sourceLabel(seed, override, dynamicSource),
    aliasSource: displayOverride?.source ?? override?.source ?? null,
    aliasConfidence: override?.confidence ?? null
  };
}

function collapseEquivalentUnits(units) {
  const byIdentity = new Map();
  for (const unit of units ?? []) {
    const identity = canonicalUnitIdentity(unit);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, unit);
      continue;
    }
    const preferred = existing.apiName === unit.apiName
      ? unit
      : preferEquivalentUnit(existing, unit);
    const fallback = preferred === existing ? unit : existing;
    const displayOverride = unitDisplayOverrideByApiName.get(preferred.apiName)
      ?? unitDisplayOverrideByApiName.get(fallback.apiName);
    byIdentity.set(identity, {
      ...preferred,
      canonicalApiName: preferred.canonicalApiName ?? fallback.canonicalApiName,
      zhName: displayOverride?.zhName ?? existing.zhName ?? unit.zhName,
      enName: displayOverride?.enName ?? existing.enName ?? unit.enName,
      aliases: compact([
        ...(displayOverride?.aliases ?? []),
        ...(preferred.aliases ?? []),
        ...(fallback.aliases ?? [])
      ]),
      fuzzyAliases: compact([
        ...(displayOverride?.fuzzyAliases ?? []),
        ...(preferred.fuzzyAliases ?? []),
        ...(fallback.fuzzyAliases ?? [])
      ])
    });
  }
  return [...byIdentity.values()].sort((a, b) => a.apiName.localeCompare(b.apiName));
}

function traitRecord(filterId, options = {}, dynamicSource = null) {
  const apiName = traitApiNameFromFilterId(filterId);
  const seed = seedTraitByFilterId.get(filterId) ?? seedTraitByApiName.get(apiName);
  const override = traitAliasOverrideByFilterId.get(filterId) ?? traitAliasOverrideByApiName.get(apiName);
  const displayOverride = traitDisplayOverrideByApiName.get(apiName);
  const lookup = options.traitLookupByApiName?.get?.(apiName) ?? null;
  const lookupName = String(lookup?.name ?? lookup?.displayName ?? "").trim() || null;
  const tierOverride = traitTierOverride(filterId, override);
  const preferredOverrideName = override?.preferZhName ? override.zhName : null;
  const token = apiToken(filterId);
  return {
    apiName: override?.apiName ?? seed?.apiName ?? apiName,
    filterId,
    zhName: displayOverride?.zhName
      ?? preferredOverrideName
      ?? lookupName
      ?? tierOverride?.zhName
      ?? override?.zhName
      ?? seed?.zhName
      ?? null,
    enName: displayOverride?.enName ?? null,
    displayName: displayOverride?.zhName
      ?? tierOverride?.displayName
      ?? override?.displayName
      ?? seed?.displayName
      ?? lookupName
      ?? tierOverride?.zhName
      ?? override?.zhName
      ?? seed?.zhName
      ?? token,
    aliases: compact([
      ...(displayOverride?.aliases ?? []),
      tierOverride?.zhName,
      tierOverride?.displayName,
      lookupName,
      override?.zhName,
      override?.displayName,
      seed?.zhName,
      seed?.displayName,
      ...(tierOverride?.aliases ?? []),
      ...(override?.aliases ?? []),
      ...(seed?.aliases ?? []),
      filterId,
      apiName,
      token
    ]),
    current: true,
    patch: options.patch ?? "current",
    source: sourceLabel(seed, override, dynamicSource),
    aliasSource: displayOverride?.source ?? override?.source ?? null,
    aliasConfidence: override?.confidence ?? null
  };
}

function collectCompsApiNames(data = {}) {
  const normalized = normalizeCompsData(data);
  const units = new Set();
  const traits = new Set();

  for (const option of normalized.compOptions ?? []) {
    for (const unit of listFromApiValue(option.units_list ?? option.units ?? option.units_string)) {
      units.add(unit);
    }
    for (const trait of listFromApiValue(option.traits_list ?? option.traits ?? option.traits_string)) {
      traits.add(trait);
    }
  }

  for (const cluster of normalized.clusterInfo ?? []) {
    for (const unit of listFromApiValue(cluster.units_string ?? cluster.units_list ?? cluster.units)) {
      units.add(unit);
    }
    for (const trait of listFromApiValue(cluster.traits_string ?? cluster.traits_list ?? cluster.traits)) {
      traits.add(trait);
    }
  }

  return {
    units: [...units].filter((apiName) => /^(?:TFT\d+_|DA_)/.test(apiName)).sort(),
    traits: [...traits].filter((apiName) => /^(?:TFT\d+_|DA_)/.test(apiName)).sort()
  };
}

function collectExplorerUnitApiNames(response = {}) {
  const units = new Map();
  for (const row of normalizeExplorerRows(response, ["units_unique"])) {
    const apiName = unitApiNameFromExplorerValue(row.units_unique ?? row.unit ?? row.units);
    if (!/^(?:TFT\d+_|DA_)/.test(apiName)) continue;
    const placements = row.placement_count ?? row.places;
    const sampleCount = Array.isArray(placements)
      ? placements.reduce((sum, count) => sum + (Number(count) || 0), 0)
      : Number(row.count ?? row.games ?? row.total ?? 0) || 0;
    units.set(apiName, Math.max(units.get(apiName) ?? 0, sampleCount));
  }
  return [...units.entries()]
    .map(([apiName, providerSampleCount]) => ({ apiName, providerSampleCount }))
    .sort((left, right) => left.apiName.localeCompare(right.apiName));
}

function collectExplorerTraitFilterIds(response = {}) {
  const traits = new Set();
  for (const row of normalizeExplorerRows(response, ["traits"])) {
    const filterId = row.traits ?? row.trait ?? row.trait_id;
    if (/^(?:TFT\d+_|DA_)/.test(filterId)) traits.add(filterId);
  }
  return [...traits].sort();
}

export function buildUnitCatalogFromCompsData(data = {}, options = {}) {
  const { units } = collectCompsApiNames(data);
  const byApiName = new Map();

  for (const apiName of units) {
    byApiName.set(apiName, unitRecord(apiName, options, "metatft_comps"));
  }

  if (options.includeSeeds !== false) {
    for (const seed of UNITS) {
      if (!byApiName.has(seed.apiName)) {
        byApiName.set(seed.apiName, unitRecord(seed.apiName, options));
      }
    }
  }

  return collapseEquivalentUnits([...byApiName.values()]);
}

export function buildUnitCatalogFromExplorerRows(response = {}, options = {}) {
  const units = collectExplorerUnitApiNames(response);
  const byApiName = new Map();

  for (const { apiName, providerSampleCount } of units) {
    byApiName.set(apiName, unitRecord(apiName, {
      ...options,
      providerSampleCount
    }, "metatft_explorer"));
  }

  if (options.includeSeeds !== false) {
    for (const seed of UNITS) {
      if (!byApiName.has(seed.apiName)) {
        byApiName.set(seed.apiName, unitRecord(seed.apiName, options));
      }
    }
  }

  return collapseEquivalentUnits([...byApiName.values()]);
}

export function buildTraitCatalogFromCompsData(data = {}, options = {}) {
  const { traits } = collectCompsApiNames(data);
  const byFilterId = new Map();

  for (const filterId of expandVerifiedTraitTiers(traits)) {
    byFilterId.set(filterId, traitRecord(filterId, options, "metatft_comps"));
  }

  if (options.includeSeeds !== false) {
    for (const seed of TRAITS) {
      if (!byFilterId.has(seed.filterId)) {
        byFilterId.set(seed.filterId, traitRecord(seed.filterId, options));
      }
    }
  }

  return [...byFilterId.values()].sort((a, b) => a.filterId.localeCompare(b.filterId));
}

export function buildTraitCatalogFromExplorerRows(response = {}, options = {}) {
  const traits = collectExplorerTraitFilterIds(response);
  const byFilterId = new Map();

  for (const filterId of expandVerifiedTraitTiers(traits)) {
    byFilterId.set(filterId, traitRecord(filterId, options, "metatft_explorer"));
  }

  if (options.includeSeeds !== false) {
    for (const seed of TRAITS) {
      if (!byFilterId.has(seed.filterId)) {
        byFilterId.set(seed.filterId, traitRecord(seed.filterId, options));
      }
    }
  }

  return [...byFilterId.values()].sort((a, b) => a.filterId.localeCompare(b.filterId));
}

export function mergeCatalogUnits(baseUnits, generatedUnits) {
  return collapseEquivalentUnits([...(baseUnits ?? []), ...(generatedUnits ?? [])]);
}

export function mergeCatalogTraits(baseTraits, generatedTraits) {
  const merged = new Map();
  for (const trait of baseTraits ?? []) merged.set(trait.filterId, trait);
  for (const trait of generatedTraits ?? []) {
    const existing = merged.get(trait.filterId);
    const displayOverride = traitDisplayOverrideByApiName.get(existing?.apiName ?? trait.apiName);
    merged.set(trait.filterId, existing ? {
      ...trait,
      apiName: existing.apiName ?? trait.apiName,
      zhName: displayOverride?.zhName ?? existing.zhName ?? trait.zhName,
      enName: displayOverride?.enName ?? existing.enName ?? trait.enName,
      displayName: displayOverride?.zhName ?? existing.displayName ?? trait.displayName,
      aliases: compact([
        ...(displayOverride?.aliases ?? []),
        ...(existing.aliases ?? []),
        ...(trait.aliases ?? [])
      ])
    } : trait);
  }
  return [...merged.values()].sort((a, b) => a.filterId.localeCompare(b.filterId));
}
