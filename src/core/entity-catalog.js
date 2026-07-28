const ENTITY_TYPES = new Set(["unit", "trait"]);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function includesQuery(values, query) {
  if (!query) return true;
  return values.some((value) => normalizedText(value).includes(query));
}

function compareNames(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
}

function publicSource(source) {
  if (!source) return null;
  return {
    version: source.version ?? null,
    season: source.season ?? null,
    updatedAt: source.updatedAt ?? null
  };
}

function unitEntries(catalog, details, options = {}) {
  const query = normalizedText(options.query);
  const cost = options.cost === undefined || options.cost === null || options.cost === ""
    ? null
    : Number(options.cost);
  const role = normalizedText(options.role);
  const trait = normalizedText(options.trait);

  return (catalog?.units ?? [])
    .filter((unit) => unit?.apiName && unit.current !== false)
    .map((unit) => {
      const official = details?.units?.get?.(unit.apiName) ?? null;
      const entry = {
        entityType: "unit",
        apiName: unit.apiName,
        name: unit.zhName ?? official?.name ?? unit.apiName,
        cost: official?.cost ?? unit.cost ?? null,
        role: official?.role ?? null,
        traitNames: [...new Set(official?.traitNames ?? [])],
        iconUrl: options.assetResolver?.resolveUnit?.(unit.apiName)?.iconUrl ?? null,
        hasDetails: Boolean(official),
        source: publicSource(official?.source)
      };
      return { entry, aliases: unit.aliases ?? [] };
    })
    .filter(({ entry, aliases }) => {
      if (Number.isFinite(cost) && Number(entry.cost) !== cost) return false;
      if (role && !normalizedText(entry.role).includes(role)) return false;
      if (trait && !entry.traitNames.some((name) => normalizedText(name).includes(trait))) return false;
      return includesQuery([
        entry.apiName,
        entry.name,
        entry.role,
        ...entry.traitNames,
        ...aliases
      ], query);
    })
    .map(({ entry }) => entry)
    .sort((left, right) => {
      const costDifference = Number(left.cost ?? 99) - Number(right.cost ?? 99);
      return costDifference || compareNames(left.name, right.name) || compareNames(left.apiName, right.apiName);
    });
}

function traitEntries(catalog, details, options = {}) {
  const query = normalizedText(options.query);
  const traitType = normalizedText(options.traitType ?? options.typeFilter);
  const byApiName = new Map();

  for (const trait of catalog?.traits ?? []) {
    if (!trait?.apiName || trait.current === false) continue;
    const existing = byApiName.get(trait.apiName);
    if (!existing) {
      byApiName.set(trait.apiName, {
        catalogTrait: trait,
        aliases: [...(trait.aliases ?? [])],
        filterIds: [trait.filterId].filter(Boolean)
      });
      continue;
    }
    existing.aliases.push(...(trait.aliases ?? []));
    if (trait.filterId) existing.filterIds.push(trait.filterId);
  }

  return [...byApiName.entries()]
    .map(([apiName, grouped]) => {
      const official = details?.traits?.get?.(apiName) ?? null;
      const catalogTrait = grouped.catalogTrait;
      const entry = {
        entityType: "trait",
        apiName,
        name: official?.name ?? catalogTrait.zhName ?? catalogTrait.displayName ?? apiName,
        traitType: official?.type ?? null,
        tierCounts: [...new Set((official?.levels ?? []).map((level) => Number(level.units)).filter(Number.isFinite))]
          .sort((left, right) => left - right),
        iconUrl: official?.iconUrl ?? null,
        hasDetails: Boolean(official),
        source: publicSource(official?.source)
      };
      return {
        entry,
        aliases: [...new Set(grouped.aliases)],
        filterIds: [...new Set(grouped.filterIds)]
      };
    })
    .filter(({ entry, aliases, filterIds }) => {
      if (traitType && normalizedText(entry.traitType) !== traitType) return false;
      return includesQuery([
        entry.apiName,
        entry.name,
        entry.traitType,
        ...entry.tierCounts,
        ...aliases,
        ...filterIds
      ], query);
    })
    .map(({ entry }) => entry)
    .sort((left, right) => {
      const typeDifference = compareNames(left.traitType, right.traitType);
      return typeDifference || compareNames(left.name, right.name) || compareNames(left.apiName, right.apiName);
    });
}

export function normalizeEntityCatalogType(value) {
  const normalized = normalizedText(value);
  if (["unit", "units", "champion", "champions", "hero", "heroes", "棋子", "英雄"].includes(normalized)) {
    return "unit";
  }
  if (["trait", "traits", "羁绊"].includes(normalized)) return "trait";
  return null;
}

export function buildEntityCatalog(catalog, details, options = {}) {
  const entityType = normalizeEntityCatalogType(options.entityType ?? options.type);
  if (!ENTITY_TYPES.has(entityType)) {
    throw Object.assign(new TypeError("entityType must be unit or trait"), {
      statusCode: 400,
      code: "invalid_entity_catalog_type"
    });
  }

  const page = integer(options.page, 1, 1, 1000);
  const limit = integer(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const entries = entityType === "unit"
    ? unitEntries(catalog, details, options)
    : traitEntries(catalog, details, options);
  const start = (page - 1) * limit;
  const items = entries.slice(start, start + limit);

  return {
    type: "entity_catalog",
    entityType,
    items,
    pagination: {
      page,
      limit,
      total: entries.length,
      returned: items.length,
      pages: Math.max(1, Math.ceil(entries.length / limit))
    },
    filters: {
      query: String(options.query ?? "").trim() || null,
      ...(entityType === "unit"
        ? {
          cost: options.cost === undefined || options.cost === null || options.cost === ""
            ? null
            : Number(options.cost),
          role: String(options.role ?? "").trim() || null,
          trait: String(options.trait ?? "").trim() || null
        }
        : {
          traitType: String(options.traitType ?? options.typeFilter ?? "").trim() || null
        })
    }
  };
}
