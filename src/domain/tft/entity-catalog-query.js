import { normalizeAlias } from "../../core/normalizer.js";

const ENTITY_TYPES = new Set(["unit", "item", "trait"]);
const MAX_LIMIT = 200;

function array(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}
function baseTraitId(value) {
  return String(value ?? "").replace(/_\d+$/, "");
}

function displayName(record = {}) {
  return record.preferredDisplayName
    ?? record.shortName
    ?? record.zhName
    ?? record.displayName
    ?? record.name
    ?? record.apiName;
}

function catalogRecords(catalog, entityType) {
  return entityType === "unit"
    ? array(catalog?.units)
    : entityType === "item"
      ? array(catalog?.items)
      : array(catalog?.traits);
}

function canonicalApiName(record, entityType) {
  return entityType === "trait"
    ? baseTraitId(record?.apiName ?? record?.filterId)
    : String(record?.apiName ?? "");
}

function recordAliases(record, entityType) {
  return [
    canonicalApiName(record, entityType),
    record?.apiName,
    record?.preferredDisplayName,
    record?.shortName,
    record?.zhName,
    record?.displayName,
    record?.name,
    ...(record?.aliases ?? [])
  ].filter(Boolean).map(String);
}

function exactAliasResolution(catalog, entityType, requestedNames) {
  const records = catalogRecords(catalog, entityType).filter((record) => record?.current !== false);
  const requests = requestedNames.map((inputName) => {
    const normalizedName = normalizeAlias(inputName);
    const byApiName = new Map();
    for (const record of records) {
      const matchedAlias = recordAliases(record, entityType).find((alias) => (
        normalizeAlias(alias) === normalizedName
      ));
      const apiName = canonicalApiName(record, entityType);
      if (!matchedAlias || !apiName || byApiName.has(apiName)) continue;
      byApiName.set(apiName, {
        apiName,
        name: String(displayName(record)),
        matchedAlias
      });
    }
    const exactMatchCount = byApiName.size;
    if (exactMatchCount === 0) {
      for (const record of records) {
        const matchedAlias = array(record?.fuzzyAliases).find((alias) => (
          normalizeAlias(alias) === normalizedName
        ));
        const apiName = canonicalApiName(record, entityType);
        if (!matchedAlias || !apiName || byApiName.has(apiName)) continue;
        byApiName.set(apiName, {
          apiName,
          name: String(displayName(record)),
          matchedAlias,
          matchType: "curated_fuzzy_alias"
        });
      }
    }
    const candidates = [...byApiName.values()].sort((left, right) => (
      left.apiName.localeCompare(right.apiName)
    ));
    return {
      inputName,
      normalizedName,
      // Curated fuzzy aliases supply stable candidates but deliberately require
      // confirmation. They never acquire exact-alias authority implicitly.
      status: exactMatchCount === 1 ? "resolved" : candidates.length ? "ambiguous" : "not_found",
      candidates
    };
  });
  return { mode: "exact_alias", requests };
}

function traitNamesFor(filters, catalog) {
  return array(filters?.traits).flatMap((value) => {
    const id = baseTraitId(value);
    const record = catalog?.traitByFilterId?.get?.(String(value))
      ?? catalog?.traitByApiName?.get?.(id);
    return [String(value), id, record?.zhName, record?.displayName, ...(record?.aliases ?? [])]
      .filter(Boolean)
      .map(String);
  });
}

function matchesRequestedTraits(unit, requestedIds, requestedNames) {
  if (!requestedIds.length) return true;
  const unitIds = new Set(array(unit.traits).flatMap((value) => [String(value), baseTraitId(value)]));
  const unitNames = new Set(array(unit.traitNames).map(String));
  return requestedIds.every((value) => {
    const id = baseTraitId(value);
    if (unitIds.has(String(value)) || unitIds.has(id)) return true;
    return requestedNames.some((name) => unitNames.has(name));
  });
}

function project(record, projection) {
  const fields = array(projection).map(String).filter(Boolean);
  if (!fields.length) return record;
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}

function compare(sort) {
  const descending = String(sort ?? "").endsWith("_desc");
  const field = String(sort ?? "").replace(/_(?:asc|desc)$/, "") || "name";
  return (left, right) => {
    const a = left?.[field];
    const b = right?.[field];
    const value = typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a ?? "").localeCompare(String(b ?? ""), "zh-CN", { numeric: true, sensitivity: "base" });
    return descending ? -value : value;
  };
}

function unitRecords(catalog, details) {
  return (catalog?.units ?? []).map((unit) => {
    const official = details?.units?.get?.(unit.apiName) ?? {};
    return {
      apiName: unit.apiName,
      name: displayName({ ...unit, ...official }),
      cost: Number.isFinite(Number(official.cost ?? unit.cost)) ? Number(official.cost ?? unit.cost) : null,
      traits: array(unit.traits),
      traitNames: array(official.traitNames ?? unit.traitNames),
      current: unit.current !== false
    };
  });
}

function itemRecords(catalog, details) {
  return (catalog?.items ?? []).map((item) => {
    const official = details?.items?.get?.(item.apiName) ?? {};
    return {
      apiName: item.apiName,
      name: displayName({ ...item, ...official }),
      category: item.category ?? official.category ?? "unknown",
      components: array(official.components ?? official.recipe ?? item.components),
      current: item.current !== false,
      obtainable: item.obtainable !== false
    };
  });
}

function traitRecords(catalog, details) {
  const grouped = new Map();
  for (const trait of catalog?.traits ?? []) {
    const apiName = baseTraitId(trait.apiName ?? trait.filterId);
    if (!apiName || grouped.has(apiName)) continue;
    const official = details?.traits?.get?.(apiName) ?? {};
    grouped.set(apiName, {
      apiName,
      name: displayName({ ...trait, ...official }),
      description: official.description ?? trait.description ?? null,
      levels: array(official.levels ?? trait.levels),
      current: trait.current !== false
    });
  }
  return [...grouped.values()];
}

export function queryEntityCatalog({ catalog, details, input = {}, updatedAt } = {}) {
  const entityType = String(input.entityType ?? "");
  if (!ENTITY_TYPES.has(entityType)) throw new TypeError("entityType must be unit, item or trait");
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const requestedTraitIds = array(filters.traits).map(String);
  const requestedTraitNames = traitNamesFor(filters, catalog);
  const requestedNames = array(filters.names).map(String);
  if (requestedNames.length && array(filters.apiNames).length) {
    throw new TypeError("filters.names and filters.apiNames are mutually exclusive");
  }
  const resolution = requestedNames.length
    ? exactAliasResolution(catalog, entityType, requestedNames)
    : null;
  const resolvedApiNames = new Set(
    resolution?.requests.flatMap((request) => request.candidates.map((candidate) => candidate.apiName)) ?? []
  );
  let results = entityType === "unit"
    ? unitRecords(catalog, details)
    : entityType === "item"
      ? itemRecords(catalog, details)
      : traitRecords(catalog, details);
  results = results.filter((record) => {
    if (filters.cost !== undefined && !array(filters.cost).map(Number).includes(Number(record.cost))) return false;
    if (filters.apiNames && !array(filters.apiNames).map(String).includes(record.apiName)) return false;
    if (resolution && !resolvedApiNames.has(record.apiName)) return false;
    if (filters.categories && !array(filters.categories).map(String).includes(record.category)) return false;
    if (filters.current !== undefined && record.current !== filters.current) return false;
    if (filters.obtainable !== undefined && record.obtainable !== filters.obtainable) return false;
    return entityType !== "unit" || matchesRequestedTraits(record, requestedTraitIds, requestedTraitNames);
  });
  results.sort(compare(input.sort));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isInteger(input.limit) ? input.limit : MAX_LIMIT));
  results = results.slice(0, limit).map((record) => project(record, input.projection));
  return {
    type: "entity_catalog_results",
    source: "official_tft_catalog",
    updatedAt: updatedAt ?? details?.meta?.updatedAt ?? new Date().toISOString(),
    entityType,
    filters: structuredClone(filters),
    ...(resolution ? { requestedNames: [...requestedNames], resolution } : {}),
    results,
    total: results.length
  };
}
