import { normalizeCompsData, normalizeExplorerRows } from "./metatft-response-adapter.js";
import { TRAITS, UNITS } from "./static-data.js";
import {
  traitAliasOverrideByApiName,
  traitAliasOverrideByFilterId,
  unitAliasOverrideByApiName
} from "./domain-alias-overrides.js";

const seedUnitByApiName = new Map(UNITS.map((unit) => [unit.apiName, unit]));
const seedTraitByFilterId = new Map(TRAITS.map((trait) => [trait.filterId, trait]));
const seedTraitByApiName = new Map(TRAITS.map((trait) => [trait.apiName, trait]));

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
    .replace(/^TFT\d*_/, "")
    .replace(/_[0-9]+$/, "");
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
  const token = apiToken(apiName);
  return {
    apiName,
    zhName: override?.zhName ?? seed?.zhName ?? null,
    aliases: compact([
      override?.zhName,
      seed?.zhName,
      ...(override?.aliases ?? []),
      ...(seed?.aliases ?? []),
      apiName,
      token
    ]),
    current: true,
    patch: options.patch ?? "current",
    source: sourceLabel(seed, override, dynamicSource),
    aliasSource: override?.source ?? null,
    aliasConfidence: override?.confidence ?? null
  };
}

function traitRecord(filterId, options = {}, dynamicSource = null) {
  const apiName = traitApiNameFromFilterId(filterId);
  const seed = seedTraitByFilterId.get(filterId) ?? seedTraitByApiName.get(apiName);
  const override = traitAliasOverrideByFilterId.get(filterId) ?? traitAliasOverrideByApiName.get(apiName);
  const tierOverride = traitTierOverride(filterId, override);
  const token = apiToken(filterId);
  return {
    apiName: override?.apiName ?? seed?.apiName ?? apiName,
    filterId,
    zhName: tierOverride?.zhName ?? override?.zhName ?? seed?.zhName ?? null,
    displayName: tierOverride?.displayName
      ?? override?.displayName
      ?? seed?.displayName
      ?? tierOverride?.zhName
      ?? override?.zhName
      ?? seed?.zhName
      ?? token,
    aliases: compact([
      tierOverride?.zhName,
      tierOverride?.displayName,
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
    aliasSource: override?.source ?? null,
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
    units: [...units].filter((apiName) => /^TFT\d+_/.test(apiName)).sort(),
    traits: [...traits].filter((apiName) => /^TFT\d+_/.test(apiName)).sort()
  };
}

function collectExplorerUnitApiNames(response = {}) {
  const units = new Set();
  for (const row of normalizeExplorerRows(response, ["units_unique"])) {
    const apiName = unitApiNameFromExplorerValue(row.units_unique ?? row.unit ?? row.units);
    if (/^TFT\d+_/.test(apiName)) units.add(apiName);
  }
  return [...units].sort();
}

function collectExplorerTraitFilterIds(response = {}) {
  const traits = new Set();
  for (const row of normalizeExplorerRows(response, ["traits"])) {
    const filterId = row.traits ?? row.trait ?? row.trait_id;
    if (/^TFT\d+_/.test(filterId)) traits.add(filterId);
  }
  return [...traits].sort();
}

export function buildUnitCatalogFromCompsData(data = {}, options = {}) {
  const { units } = collectCompsApiNames(data);
  const byApiName = new Map();

  for (const apiName of units) {
    byApiName.set(apiName, unitRecord(apiName, options, "metatft_comps"));
  }

  for (const seed of UNITS) {
    if (!byApiName.has(seed.apiName)) {
      byApiName.set(seed.apiName, unitRecord(seed.apiName, options));
    }
  }

  return [...byApiName.values()].sort((a, b) => a.apiName.localeCompare(b.apiName));
}

export function buildUnitCatalogFromExplorerRows(response = {}, options = {}) {
  const units = collectExplorerUnitApiNames(response);
  const byApiName = new Map();

  for (const apiName of units) {
    byApiName.set(apiName, unitRecord(apiName, options, "metatft_explorer"));
  }

  for (const seed of UNITS) {
    if (!byApiName.has(seed.apiName)) {
      byApiName.set(seed.apiName, unitRecord(seed.apiName, options));
    }
  }

  return [...byApiName.values()].sort((a, b) => a.apiName.localeCompare(b.apiName));
}

export function buildTraitCatalogFromCompsData(data = {}, options = {}) {
  const { traits } = collectCompsApiNames(data);
  const byFilterId = new Map();

  for (const filterId of expandVerifiedTraitTiers(traits)) {
    byFilterId.set(filterId, traitRecord(filterId, options, "metatft_comps"));
  }

  for (const seed of TRAITS) {
    if (!byFilterId.has(seed.filterId)) {
      byFilterId.set(seed.filterId, traitRecord(seed.filterId, options));
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

  for (const seed of TRAITS) {
    if (!byFilterId.has(seed.filterId)) {
      byFilterId.set(seed.filterId, traitRecord(seed.filterId, options));
    }
  }

  return [...byFilterId.values()].sort((a, b) => a.filterId.localeCompare(b.filterId));
}

export function mergeCatalogUnits(baseUnits, generatedUnits) {
  const merged = new Map();
  for (const unit of baseUnits ?? []) merged.set(unit.apiName, unit);
  for (const unit of generatedUnits ?? []) {
    const existing = merged.get(unit.apiName);
    merged.set(unit.apiName, existing ? {
      ...unit,
      zhName: existing.zhName ?? unit.zhName,
      aliases: compact([...(existing.aliases ?? []), ...(unit.aliases ?? [])])
    } : unit);
  }
  return [...merged.values()].sort((a, b) => a.apiName.localeCompare(b.apiName));
}

export function mergeCatalogTraits(baseTraits, generatedTraits) {
  const merged = new Map();
  for (const trait of baseTraits ?? []) merged.set(trait.filterId, trait);
  for (const trait of generatedTraits ?? []) {
    const existing = merged.get(trait.filterId);
    merged.set(trait.filterId, existing ? {
      ...trait,
      apiName: existing.apiName ?? trait.apiName,
      zhName: existing.zhName ?? trait.zhName,
      displayName: existing.displayName ?? trait.displayName,
      aliases: compact([...(existing.aliases ?? []), ...(trait.aliases ?? [])])
    } : trait);
  }
  return [...merged.values()].sort((a, b) => a.filterId.localeCompare(b.filterId));
}
